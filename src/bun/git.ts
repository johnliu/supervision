// Git data layer. Runs the git CLI and shapes the output into the ReviewModel
// the UI consumes. Each FileChange carries the old/new full file contents (so the
// diff viewer can expand collapsed context) plus the +/- line counts (from
// `git diff --numstat`). Binary files are flagged via numstat's "-/-" marker and
// have their contents omitted, so a large binary never gets read into memory or
// shipped over the RPC bridge.

import { join } from 'node:path';
import type { CommitInfo, CompareSpec, FileChange, FileStatus, ReviewModel } from '../shared/types';

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

async function toFileChange(repo: string, entry: NameStatusEntry, staged: boolean): Promise<FileChange> {
  // Stat first: a binary file's contents are never read (the whole point of the
  // flag), so we can't parallelize the contents fetch with it.
  const stat = await trackedStat(repo, staged, entry);
  const contents = stat.binary
    ? {
        oldContents: '',
        newContents: '',
      }
    : await trackedContents(repo, staged, entry);
  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    oldContents: contents.oldContents,
    newContents: contents.newContents,
    additions: stat.additions,
    deletions: stat.deletions,
    binary: stat.binary,
    staged,
    untracked: false,
  };
}

async function untrackedChange(repo: string, path: string): Promise<FileChange> {
  const stat = await untrackedStat(repo, path);
  return {
    path,
    status: 'untracked',
    oldContents: '',
    newContents: stat.binary ? '' : await workingFile(repo, path),
    additions: stat.additions,
    deletions: stat.deletions,
    binary: stat.binary,
    staged: false,
    untracked: true,
  };
}

async function getWorkingReview(repoRoot: string): Promise<ReviewModel> {
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
    Promise.all(stagedEntries.map((e) => toFileChange(repoRoot, e, true))),
    Promise.all(unstagedEntries.map((e) => toFileChange(repoRoot, e, false))),
    Promise.all(untrackedPaths.map((p) => untrackedChange(repoRoot, p))),
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

/** The parent of `ref`, or the empty tree if `ref` is a root commit. */
async function resolveBase(repoRoot: string, ref: string): Promise<string> {
  const res = await git(repoRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^`,
  ]);
  return res.exitCode === 0 ? `${ref}^` : EMPTY_TREE;
}

/** File changes between two refs (no staging concept — all "unreviewed"). */
async function refFileChanges(repoRoot: string, base: string, head: string): Promise<FileChange[]> {
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
  return Promise.all(
    entries.map(async (entry): Promise<FileChange> => {
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
        base,
        head,
        '--',
        ...paths,
      ]);
      const stat = parseNumstat(numstat.stdout);
      const [oldContents, newContents] = stat.binary
        ? [
            '',
            '',
          ]
        : await Promise.all([
            showContents(repoRoot, base, entry.oldPath ?? entry.path),
            showContents(repoRoot, head, entry.path),
          ]);
      return {
        path: entry.path,
        oldPath: entry.oldPath,
        status: entry.status,
        oldContents,
        newContents,
        additions: stat.additions,
        deletions: stat.deletions,
        binary: stat.binary,
        staged: false,
        untracked: false,
      };
    }),
  );
}

export async function getReview(cwd: string, compare: CompareSpec): Promise<ReviewModel> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
  if (compare.kind === 'working') {
    return getWorkingReview(repoRoot);
  }

  const [base, head] =
    compare.kind === 'commit'
      ? [
          await resolveBase(repoRoot, compare.ref),
          compare.ref,
        ]
      : [
          compare.base,
          compare.head,
        ];
  // Ref comparisons have no index, so everything is "unreviewed".
  const files = await refFileChanges(repoRoot, base, head);
  return {
    repoRoot,
    compare,
    reviewed: [],
    unreviewed: files,
  };
}

// History panel depth. Enough scrollback to find a recent base; not the
// whole history of a large repo.
const LOG_LIMIT = 100;

/**
 * Recent commits, newest first. Fields are separated by control characters
 * (unit/record separators) so subjects with any printable punctuation parse
 * cleanly. An empty repo (no commits yet) yields [].
 */
export async function getLog(cwd: string): Promise<CommitInfo[]> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return [];
  }
  const res = await git(repoRoot, [
    'log',
    `-${LOG_LIMIT}`,
    '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e',
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
