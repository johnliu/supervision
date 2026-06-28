// Git data layer. Runs the git CLI and shapes the output into the ReviewModel
// the UI consumes. Each FileChange carries the old/new full file contents (so the
// diff viewer can expand collapsed context) plus the +/- line counts (from
// `git diff --numstat`). Binary files are flagged via numstat's "-/-" marker and
// have their contents omitted, so a large binary never gets read into memory or
// shipped over the RPC bridge.

import { basename, dirname, join, resolve, sep } from 'node:path';
import { imageMime } from '../shared/preview';
import type {
  BranchInfo,
  CommitDetails,
  CommitInfo,
  CompareSpec,
  FileChange,
  FilePayload,
  FileStatus,
  RepoInfo,
  ReviewModel,
  WorktreeInfo,
} from '../shared/types';
import { annotateRead } from './readState';

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface NameStatusEntry {
  path: string;
  oldPath?: string;
  status: FileStatus;
}

/**
 * Run a git command in `repo`. Never throws on non-zero exit (we inspect it).
 * Exported so the watcher reuses this one hardened spawn path.
 *
 * Uses Bun.spawn with explicit stream draining rather than the `$` shell:
 * `$`…`.quiet()` stops draining the stdout pipe under concurrency, so a command
 * whose output exceeds the ~64KB OS pipe buffer (e.g. `git show :bun.lock`)
 * blocks on write and hangs. Draining stdout/stderr as streams avoids that.
 */
export async function git(repo: string, args: string[]): Promise<GitResult> {
  try {
    const proc = Bun.spawn(
      [
        'git',
        ...args,
      ],
      {
        cwd: repo,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      stdout,
      stderr,
      exitCode,
    };
  } catch (error) {
    // Bun.spawn THROWS (posix_spawn ENOENT) when `repo` no longer exists —
    // e.g. a recents entry whose worktree was deleted. Shape it like any
    // other failed git call so callers' exit-code checks handle it.
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: -1,
    };
  }
}

// The patch carries only git's hunks (default 3-line context) — the client
// supplies the full contents separately, so there's no need to inflate the
// patch with the whole file.
const DIFF_CONTEXT = 3;

/** `--ignore-all-space` when whitespace is being ignored, else nothing. */
function whitespaceArgs(ignoreWhitespace: boolean): string[] {
  return ignoreWhitespace
    ? [
        '--ignore-all-space',
      ]
    : [];
}

/** Contents of a blob at `rev` ('HEAD', '' for the index, a sha…); '' if absent. */
async function showContents(repo: string, rev: string, path: string): Promise<string> {
  const res = await git(repo, [
    'show',
    `${rev}:${path}`,
  ]);
  return res.exitCode === 0 ? res.stdout : '';
}

/** Working-tree file contents; '' if the file is gone. */
async function workingFile(repo: string, path: string): Promise<string> {
  const file = Bun.file(join(repo, path));
  return (await file.exists()) ? file.text() : '';
}

export async function getRepoRoot(cwd: string): Promise<string | null> {
  const res = await git(cwd, [
    'rev-parse',
    '--show-toplevel',
  ]);
  if (res.exitCode !== 0) {
    return null;
  }
  return res.stdout.trim() || null;
}

/**
 * Project / worktree / branch identity for the footer. A linked worktree is
 * detected by its git dir living under the main checkout's common dir
 * (`<main>/.git/worktrees/<name>`); the project root is the common dir's
 * parent. Branch resolution: symbolic ref (works on an unborn branch), else a
 * short sha (detached HEAD), else null (not a repo / no commits).
 */
export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const root = await getRepoRoot(cwd);
  if (!root) {
    return {
      root: cwd,
      projectRoot: cwd,
      branch: null,
      worktree: null,
    };
  }
  const [symbolicRes, gitDirRes, commonRes] = await Promise.all([
    git(root, [
      'symbolic-ref',
      '--short',
      '-q',
      'HEAD',
    ]),
    git(root, [
      'rev-parse',
      '--absolute-git-dir',
    ]),
    git(root, [
      'rev-parse',
      '--git-common-dir',
    ]),
  ]);
  let branch = symbolicRes.exitCode === 0 ? symbolicRes.stdout.trim() : null;
  if (!branch) {
    const sha = await git(root, [
      'rev-parse',
      '--short',
      'HEAD',
    ]);
    branch = sha.exitCode === 0 ? sha.stdout.trim() : null;
  }
  const gitDir = gitDirRes.exitCode === 0 ? gitDirRes.stdout.trim() : join(root, '.git');
  // --git-common-dir may print a relative path (".git" in the main checkout).
  const commonDir = commonRes.exitCode === 0 ? resolve(root, commonRes.stdout.trim()) : gitDir;
  const linked = gitDir !== commonDir;
  return {
    root,
    projectRoot: linked ? dirname(commonDir) : root,
    branch,
    worktree: linked ? basename(root) : null,
  };
}

/**
 * Parse `git worktree list --porcelain`: blank-line-separated records of
 * `worktree <path>` / `HEAD <sha>` / `branch refs/heads/<name>` (or
 * `detached`). The main checkout is always the first record; bare records
 * have no working tree to review and are skipped.
 */
export function parseWorktreeList(out: string, currentRoot: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let first = true;
  for (const record of out.split('\n\n')) {
    const lines = record.split('\n').filter((line) => line.length > 0);
    if (lines.length === 0) {
      continue;
    }
    const main = first;
    first = false;
    let path: string | null = null;
    let branch: string | null = null;
    let bare = false;
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch refs/heads/')) {
        branch = line.slice('branch refs/heads/'.length);
      } else if (line === 'bare') {
        bare = true;
      }
    }
    if (!path || bare) {
      continue;
    }
    worktrees.push({
      path,
      branch,
      current: path === currentRoot,
      main,
    });
  }
  return worktrees;
}

/** All checkouts of the project the current root belongs to. */
export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const root = await getRepoRoot(cwd);
  if (!root) {
    return [];
  }
  const res = await git(root, [
    'worktree',
    'list',
    '--porcelain',
  ]);
  if (res.exitCode !== 0) {
    return [];
  }
  return parseWorktreeList(res.stdout, root);
}

/**
 * Local branches, most recently committed first. Branches checked out in
 * ANOTHER worktree carry that worktree's root (git refuses `switch` for them).
 */
export async function listBranches(cwd: string): Promise<BranchInfo[]> {
  const root = await getRepoRoot(cwd);
  if (!root) {
    return [];
  }
  const [refs, worktrees] = await Promise.all([
    git(root, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)',
      'refs/heads',
    ]),
    listWorktrees(root),
  ]);
  if (refs.exitCode !== 0) {
    return [];
  }
  const current = worktrees.find((worktree) => worktree.current)?.branch ?? null;
  const elsewhere = new Map(
    worktrees
      .filter((worktree) => !worktree.current && worktree.branch)
      .map((worktree) => [
        worktree.branch,
        worktree.path,
      ]),
  );
  return refs.stdout
    .split('\n')
    .filter((name) => name.length > 0)
    .map((name) => ({
      name,
      current: name === current,
      worktree: name === current ? null : (elsewhere.get(name) ?? null),
    }));
}

/** Check out `name` in the current worktree, keeping local edits if git can. */
export async function switchBranch(
  cwd: string,
  name: string,
): Promise<{
  ok: boolean;
  error?: string;
}> {
  const root = await getRepoRoot(cwd);
  if (!root) {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
    };
  }
  const res = await git(root, [
    'switch',
    name,
  ]);
  return res.exitCode === 0
    ? {
        ok: true,
      }
    : {
        ok: false,
        error: res.stderr.trim() || `git switch ${name} failed`,
      };
}

function mapStatusLetter(letter: string): FileStatus {
  switch (letter) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'renamed';
    default:
      return 'modified';
  }
}

/**
 * Parse `git diff --name-status -z` output. With `-z`, fields are NUL-separated
 * and renames/copies emit the score token followed by two path tokens.
 */
function parseNameStatusZ(out: string): NameStatusEntry[] {
  const tokens = out.split('\0').filter((t) => t.length > 0);
  const entries: NameStatusEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++];
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      entries.push({
        path: newPath,
        oldPath,
        status: mapStatusLetter(letter),
      });
    } else {
      const path = tokens[i++];
      entries.push({
        path,
        status: mapStatusLetter(letter),
      });
    }
  }
  return entries;
}

interface DiffStat {
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Parse one `git diff --numstat` record: "<adds>\t<dels>\t<path>". Binary files
 * report "-\t-" — git's locale-independent binary marker (it also honors
 * .gitattributes), which we use to skip reading their contents.
 */
function parseNumstat(out: string): DiffStat {
  const line = out.split('\n').find((l) => l.trim().length > 0);
  if (!line) {
    return {
      additions: 0,
      deletions: 0,
      binary: false,
    };
  }
  const [adds, dels] = line.split('\t');
  if (adds === '-' || dels === '-') {
    return {
      additions: 0,
      deletions: 0,
      binary: true,
    };
  }
  return {
    additions: Number.parseInt(adds, 10) || 0,
    deletions: Number.parseInt(dels, 10) || 0,
    binary: false,
  };
}

/** +/- counts and binary flag for a tracked change (staged or unstaged). */
async function trackedStat(repo: string, staged: boolean, entry: NameStatusEntry): Promise<DiffStat> {
  const paths = entry.oldPath
    ? [
        entry.oldPath,
        entry.path,
      ]
    : [
        entry.path,
      ];
  const res = await git(repo, [
    'diff',
    ...(staged
      ? [
          '--staged',
        ]
      : []),
    '--numstat',
    '--',
    ...paths,
  ]);
  return parseNumstat(res.stdout);
}

/** +/- counts and binary flag for an untracked file (vs an empty base). */
async function untrackedStat(repo: string, path: string): Promise<DiffStat> {
  // --no-index exits 1 when there is a difference, which is the normal case.
  const res = await git(repo, [
    'diff',
    '--no-index',
    '--numstat',
    '--',
    '/dev/null',
    path,
  ]);
  return parseNumstat(res.stdout);
}

/**
 * git's unified diff for a tracked change. Unstaged compares the index →
 * working tree; staged compares HEAD → index. `-M` keeps renames as a single
 * rename patch (the name-status pass already detected them).
 */
async function trackedPatch(
  repo: string,
  staged: boolean,
  entry: NameStatusEntry,
  ignoreWhitespace: boolean,
): Promise<string> {
  const paths = entry.oldPath
    ? [
        entry.oldPath,
        entry.path,
      ]
    : [
        entry.path,
      ];
  const res = await git(repo, [
    'diff',
    ...(staged
      ? [
          '--staged',
        ]
      : []),
    `-U${DIFF_CONTEXT}`,
    '-M',
    ...whitespaceArgs(ignoreWhitespace),
    '--',
    ...paths,
  ]);
  return res.stdout;
}

/**
 * Old/new contents for a tracked change. Unstaged compares the index → working
 * tree; staged compares HEAD → index. Renames read the old name on the old side.
 */
async function trackedContents(
  repo: string,
  staged: boolean,
  entry: NameStatusEntry,
): Promise<{
  oldContents: string;
  newContents: string;
}> {
  const oldName = entry.oldPath ?? entry.path;
  if (staged) {
    return {
      oldContents: await showContents(repo, 'HEAD', oldName),
      newContents: await showContents(repo, '', entry.path),
    };
  }
  return {
    oldContents: await showContents(repo, '', oldName),
    newContents: entry.status === 'deleted' ? '' : await workingFile(repo, entry.path),
  };
}

async function toFileChange(
  repo: string,
  entry: NameStatusEntry,
  staged: boolean,
  ignoreWhitespace: boolean,
): Promise<FileChange> {
  // Stat first: a binary file gets no patch or contents (the point of the flag),
  // so we can't unconditionally parallelize those fetches with it.
  const stat = await trackedStat(repo, staged, entry);
  const [contents, patch] = stat.binary
    ? [
        {
          oldContents: '',
          newContents: '',
        },
        '',
      ]
    : await Promise.all([
        trackedContents(repo, staged, entry),
        trackedPatch(repo, staged, entry, ignoreWhitespace),
      ]);
  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    oldContents: contents.oldContents,
    newContents: contents.newContents,
    patch,
    additions: stat.additions,
    deletions: stat.deletions,
    binary: stat.binary,
    staged,
    untracked: false,
    read: false,
  };
}

async function untrackedChange(repo: string, path: string, ignoreWhitespace: boolean): Promise<FileChange> {
  const stat = await untrackedStat(repo, path);
  // --no-index diffs the file against /dev/null (all additions); exits 1 on a
  // difference, which is the normal case here.
  const [newContents, patch] = stat.binary
    ? [
        '',
        '',
      ]
    : await Promise.all([
        workingFile(repo, path),
        git(repo, [
          'diff',
          '--no-index',
          `-U${DIFF_CONTEXT}`,
          ...whitespaceArgs(ignoreWhitespace),
          '--',
          '/dev/null',
          path,
        ]).then((res) => res.stdout),
      ]);
  return {
    path,
    status: 'untracked',
    oldContents: '',
    newContents,
    patch,
    additions: stat.additions,
    deletions: stat.deletions,
    binary: stat.binary,
    staged: false,
    untracked: true,
    read: false,
  };
}

async function getWorkingReview(repoRoot: string, ignoreWhitespace: boolean): Promise<ReviewModel> {
  const [stagedRes, unstagedRes, untrackedRes] = await Promise.all([
    git(repoRoot, [
      'diff',
      '--staged',
      '--name-status',
      '-z',
    ]),
    git(repoRoot, [
      'diff',
      '--name-status',
      '-z',
    ]),
    git(repoRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]),
  ]);

  const stagedEntries = parseNameStatusZ(stagedRes.stdout);
  const unstagedEntries = parseNameStatusZ(unstagedRes.stdout);
  const untrackedPaths = untrackedRes.stdout.split('\0').filter((p) => p.length > 0);

  const [reviewed, unstaged, untracked] = await Promise.all([
    Promise.all(stagedEntries.map((e) => toFileChange(repoRoot, e, true, ignoreWhitespace))),
    Promise.all(unstagedEntries.map((e) => toFileChange(repoRoot, e, false, ignoreWhitespace))),
    Promise.all(untrackedPaths.map((p) => untrackedChange(repoRoot, p, ignoreWhitespace))),
  ]);

  return {
    repoRoot,
    compare: {
      kind: 'working',
    },
    reviewed,
    unreviewed: [
      ...unstaged,
      ...untracked,
    ],
  };
}

// git's well-known empty-tree object, used as the base for a root commit.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** `${ref}^` when `ref` has a parent, or null when it's a root commit. */
async function parentRev(repoRoot: string, ref: string): Promise<string | null> {
  const res = await git(repoRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^`,
  ]);
  return res.exitCode === 0 ? `${ref}^` : null;
}

/** The parent of `ref`, or the empty tree if `ref` is a root commit. */
async function resolveBase(repoRoot: string, ref: string): Promise<string> {
  return (await parentRev(repoRoot, ref)) ?? EMPTY_TREE;
}

/**
 * One file's change for a revision-based diff. `revs` are the endpoints passed
 * straight to `git diff` — `[base, head]` for a ref pair, `[base]` for
 * base→worktree (`head` null). numstat gives the counts + binary flag, the
 * patch gives git's hunks, and the old/new blobs supply the line text: the old
 * side is `base`; the new side is `head`'s blob for a ref pair, or the working
 * tree for base→worktree.
 */
async function refChange(
  repoRoot: string,
  base: string,
  head: string | null,
  entry: NameStatusEntry,
  ignoreWhitespace: boolean,
): Promise<FileChange> {
  const revs =
    head === null
      ? [
          base,
        ]
      : [
          base,
          head,
        ];
  const oldName = entry.oldPath ?? entry.path;
  const paths = entry.oldPath
    ? [
        entry.oldPath,
        entry.path,
      ]
    : [
        entry.path,
      ];
  const numstat = await git(repoRoot, [
    'diff',
    '--numstat',
    ...revs,
    '--',
    ...paths,
  ]);
  const stat = parseNumstat(numstat.stdout);
  const [oldContents, newContents, patch] = stat.binary
    ? [
        '',
        '',
        '',
      ]
    : await Promise.all([
        showContents(repoRoot, base, oldName),
        head === null
          ? entry.status === 'deleted'
            ? Promise.resolve('')
            : workingFile(repoRoot, entry.path)
          : showContents(repoRoot, head, entry.path),
        git(repoRoot, [
          'diff',
          `-U${DIFF_CONTEXT}`,
          '-M',
          ...whitespaceArgs(ignoreWhitespace),
          ...revs,
          '--',
          ...paths,
        ]).then((res) => res.stdout),
      ]);
  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    oldContents,
    newContents,
    patch,
    additions: stat.additions,
    deletions: stat.deletions,
    binary: stat.binary,
    staged: false,
    untracked: false,
    read: false,
  };
}

/** File changes between two refs (no staging concept — all "unreviewed"). */
async function refFileChanges(
  repoRoot: string,
  base: string,
  head: string,
  ignoreWhitespace: boolean,
): Promise<FileChange[]> {
  const ns = await git(repoRoot, [
    'diff',
    '--name-status',
    '-z',
    base,
    head,
  ]);
  if (ns.exitCode !== 0) {
    throw new Error(ns.stderr.trim() || `git diff ${base} ${head} failed`);
  }
  const entries = parseNameStatusZ(ns.stdout);
  return Promise.all(entries.map((entry) => refChange(repoRoot, base, head, entry, ignoreWhitespace)));
}

/**
 * File changes from `base` to the working tree: tracked changes via a one-arg
 * `git diff <base>` (worktree vs base, staged or not), plus untracked files —
 * which diff never reports — the same way the working review finds them.
 */
async function workingRangeChanges(repoRoot: string, base: string, ignoreWhitespace: boolean): Promise<FileChange[]> {
  const [ns, untrackedRes] = await Promise.all([
    git(repoRoot, [
      'diff',
      '--name-status',
      '-z',
      base,
    ]),
    git(repoRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]),
  ]);
  if (ns.exitCode !== 0) {
    throw new Error(ns.stderr.trim() || `git diff ${base} failed`);
  }
  const entries = parseNameStatusZ(ns.stdout);
  const untrackedPaths = untrackedRes.stdout.split('\0').filter((p) => p.length > 0);
  const [tracked, untracked] = await Promise.all([
    Promise.all(entries.map((entry) => refChange(repoRoot, base, null, entry, ignoreWhitespace))),
    Promise.all(untrackedPaths.map((p) => untrackedChange(repoRoot, p, ignoreWhitespace))),
  ]);
  return [
    ...tracked,
    ...untracked,
  ];
}

export async function getReview(cwd: string, compare: CompareSpec, ignoreWhitespace: boolean): Promise<ReviewModel> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  let model: ReviewModel;
  if (compare.kind === 'working') {
    model = await getWorkingReview(repoRoot, ignoreWhitespace);
  } else {
    // Ref comparisons have no index, so everything starts "unreviewed". A range's
    // `base`/`head` are the oldest/newest *selected* commits, both inclusive — so
    // we diff from base's parent to show the selected commits' net change (not
    // from base itself, which would drop the oldest selected commit's own diff).
    let files: FileChange[];
    if (compare.kind === 'commit') {
      files = await refFileChanges(repoRoot, await resolveBase(repoRoot, compare.ref), compare.ref, ignoreWhitespace);
    } else if (compare.head === null) {
      files = await workingRangeChanges(repoRoot, await resolveBase(repoRoot, compare.base), ignoreWhitespace);
    } else {
      files = await refFileChanges(repoRoot, await resolveBase(repoRoot, compare.base), compare.head, ignoreWhitespace);
    }
    model = {
      repoRoot,
      compare,
      reviewed: [],
      unreviewed: files,
    };
  }

  // Single exit so read state overlays every mode (the flag is content-
  // addressed, so this is a no-op when nothing in the repo is marked read).
  return annotateRead(repoRoot, model);
}

// History panel depth. Enough scrollback to find a recent base; not the
// whole history of a large repo.
const LOG_LIMIT = 100;

/**
 * Run `git log` with the given revision args and parse the records. Fields
 * are separated by control characters (unit/record separators) so subjects
 * with any printable punctuation parse cleanly. Failures (empty repo, bad
 * revision) yield [].
 */
async function logCommits(repoRoot: string, revisionArgs: string[]): Promise<CommitInfo[]> {
  const res = await git(repoRoot, [
    'log',
    `-${LOG_LIMIT}`,
    '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e',
    ...revisionArgs,
  ]);
  if (res.exitCode !== 0) {
    return [];
  }
  return res.stdout
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, shortHash, subject, authorName, authorDate] = record.split('\x1f');
      return {
        hash,
        shortHash,
        subject,
        authorName,
        authorDate,
      };
    });
}

/** Recent commits, newest first. An empty repo (no commits yet) yields []. */
export async function getLog(cwd: string): Promise<CommitInfo[]> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return [];
  }
  return logCommits(repoRoot, []);
}

/** The selected commit span, newest first (the range-compare overview). `base`
 * and `head` are the oldest/newest selected commits, both inclusive, so the list
 * runs from base's parent up to head — matching the net diff getReview shows. A
 * null head means the working tree, whose commit endpoint is HEAD. A root `base`
 * has no parent, so everything up to head already includes it. */
export async function getRangeLog(cwd: string, base: string, head: string | null): Promise<CommitInfo[]> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return [];
  }
  const tip = head ?? 'HEAD';
  // A base that doesn't resolve (bad ref) yields no commits — as the old
  // `base..head` did — rather than falling through to the entire log.
  const baseValid = await git(repoRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${base}^{commit}`,
  ]);
  if (baseValid.exitCode !== 0) {
    return [];
  }
  const from = await parentRev(repoRoot, base);
  return logCommits(repoRoot, [
    from === null ? tip : `${from}..${tip}`,
  ]);
}

/**
 * Full message + author identity of one commit. Fields are unit-separated
 * with the free-form body LAST, so a body containing the separator (or any
 * punctuation) can be re-joined instead of corrupting earlier fields.
 */
export async function getCommitDetails(cwd: string, ref: string): Promise<CommitDetails | null> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return null;
  }
  const res = await git(repoRoot, [
    'show',
    '-s',
    '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b',
    ref,
  ]);
  if (res.exitCode !== 0) {
    return null;
  }
  const [hash, shortHash, authorName, authorEmail, authorDate, subject, ...bodyParts] = res.stdout.split('\x1f');
  if (!hash || subject === undefined) {
    return null;
  }
  return {
    hash: hash.trim(),
    shortHash,
    subject,
    body: bodyParts.join('\x1f').trimEnd(),
    authorName,
    authorEmail,
    authorDate,
  };
}

// Inline preview size cap: a wallpaper-sized PNG is fine, a stray video or
// design asset checked in by mistake is not worth shipping over the bridge.
const PREVIEW_BYTE_LIMIT = 20 * 1024 * 1024;

/** `git show` plumbing that preserves raw bytes (the text path mangles them). */
async function showBytes(repo: string, rev: string, path: string): Promise<ArrayBuffer | null> {
  try {
    const proc = Bun.spawn(
      [
        'git',
        'show',
        `${rev}:${path}`,
      ],
      {
        cwd: repo,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [bytes, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      proc.exited,
    ]);
    return exitCode === 0 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Raw bytes of `path` (at `ref`, or from the working tree) as base64 with an
 * extension-derived mime type — the data for inline image previews.
 */
export async function readFileBase64(cwd: string, relPath: string, ref?: string): Promise<FilePayload> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
    };
  }
  const mime = imageMime(relPath);
  if (!mime) {
    return {
      ok: false,
      error: `No previewable type for ${relPath}`,
    };
  }
  let bytes: ArrayBuffer | null = null;
  if (ref) {
    bytes = await showBytes(repoRoot, ref, relPath);
  } else {
    // Working tree: paths come from the review model (repo-relative), but
    // keep reads contained to the repo anyway.
    const abs = resolve(repoRoot, relPath);
    if (!abs.startsWith(repoRoot + sep)) {
      return {
        ok: false,
        error: `Path escapes the repository: ${relPath}`,
      };
    }
    const file = Bun.file(abs);
    bytes = (await file.exists()) ? await file.arrayBuffer() : null;
  }
  if (!bytes) {
    return {
      ok: false,
      error: `Cannot read ${relPath}${ref ? ` at ${ref}` : ''}`,
    };
  }
  if (bytes.byteLength > PREVIEW_BYTE_LIMIT) {
    return {
      ok: false,
      error: `File too large to preview (${Math.round(bytes.byteLength / 1024 / 1024)} MB)`,
    };
  }
  return {
    ok: true,
    mime,
    base64: Buffer.from(bytes).toString('base64'),
  };
}

/** Approve = move changes into the index. */
export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await git(cwd, [
    'add',
    '--',
    ...paths,
  ]);
}

/** Unapprove = remove changes from the index, keeping working-tree edits. */
export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await git(cwd, [
    'restore',
    '--staged',
    '--',
    ...paths,
  ]);
}
