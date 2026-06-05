// Git data layer. Runs the git CLI via Bun's shell and shapes the output into
// the ReviewModel the UI consumes. We fetch one patch per file (rather than
// splitting a combined diff) so each FileChange carries a ready-to-render,
// single-file unified diff.

import { $ } from 'bun';
import type { CompareSpec, FileChange, FileStatus, ReviewModel } from '../shared/types';

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

/** Run a git command in `repo`. Never throws on non-zero exit (we inspect it). */
async function git(repo: string, args: string[]): Promise<GitResult> {
  const res = await $`git ${args}`.cwd(repo).quiet().nothrow();
  return {
    stdout: res.stdout.toString(),
    stderr: res.stderr.toString(),
    exitCode: res.exitCode,
  };
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

function countChanges(patch: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }
  return {
    additions,
    deletions,
  };
}

/** Single-file diff for a tracked change (staged or unstaged). */
async function trackedPatch(repo: string, staged: boolean, entry: NameStatusEntry): Promise<string> {
  const paths = entry.oldPath
    ? [
        entry.oldPath,
        entry.path,
      ]
    : [
        entry.path,
      ];
  const args = [
    'diff',
    ...(staged
      ? [
          '--staged',
        ]
      : []),
    '--',
    ...paths,
  ];
  const res = await git(repo, args);
  return res.stdout;
}

/** Synthesize a unified diff for an untracked file via diff --no-index. */
async function untrackedPatch(repo: string, path: string): Promise<string> {
  // --no-index exits 1 when there is a difference, which is the normal case.
  const res = await git(repo, [
    'diff',
    '--no-index',
    '--',
    '/dev/null',
    path,
  ]);
  return res.stdout;
}

async function toFileChange(repo: string, entry: NameStatusEntry, staged: boolean): Promise<FileChange> {
  const patch = await trackedPatch(repo, staged, entry);
  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    patch,
    ...countChanges(patch),
    staged,
    untracked: false,
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
    Promise.all(
      untrackedPaths.map(async (p): Promise<FileChange> => {
        const patch = await untrackedPatch(repoRoot, p);
        return {
          path: p,
          status: 'untracked',
          patch,
          ...countChanges(patch),
          staged: false,
          untracked: true,
        };
      }),
    ),
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
      const res = await git(repoRoot, [
        'diff',
        base,
        head,
        '--',
        ...paths,
      ]);
      return {
        path: entry.path,
        oldPath: entry.oldPath,
        status: entry.status,
        patch: res.stdout,
        ...countChanges(res.stdout),
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
