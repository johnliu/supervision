// Worktree & branch listing: porcelain parsing plus an integration pass over
// a real temp repo with a linked worktree.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git, listBranches, listWorktrees, parseWorktreeList, switchBranch } from './git';

describe('parseWorktreeList', () => {
  const OUT = [
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /repo/.claude/worktrees/task-a',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/feature',
    '',
    'worktree /repo/.claude/worktrees/probe',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    '',
  ].join('\n');

  test('WTL-1: records parse with main first, branches, and detached HEADs', () => {
    expect(parseWorktreeList(OUT, '/repo/.claude/worktrees/task-a')).toEqual([
      {
        path: '/repo',
        branch: 'main',
        current: false,
        main: true,
      },
      {
        path: '/repo/.claude/worktrees/task-a',
        branch: 'feature',
        current: true,
        main: false,
      },
      {
        path: '/repo/.claude/worktrees/probe',
        branch: null,
        current: false,
        main: false,
      },
    ]);
  });

  test('WTL-2: bare records are skipped (nothing to review there)', () => {
    const bare = `worktree /repo.git\nbare\n\n${OUT}`;
    const parsed = parseWorktreeList(bare, '/repo');
    expect(parsed.map((worktree) => worktree.path)).toEqual([
      '/repo',
      '/repo/.claude/worktrees/task-a',
      '/repo/.claude/worktrees/probe',
    ]);
    // The bare record consumed the "main = first" slot by position, so the
    // first real checkout must still be flagged main.
    expect(parsed[0].main).toBe(false);
  });
});

describe('git spawn hardening', () => {
  test('GIT-1: a vanished cwd reads as a failed call, not a thrown ENOENT', async () => {
    // Bun.spawn throws posix_spawn ENOENT for a missing cwd; recents
    // normalization iterates over paths that may have been deleted.
    const res = await git('/nonexistent/deleted-worktree', [
      'rev-parse',
      '--show-toplevel',
    ]);
    expect(res.exitCode).not.toBe(0);
  });
});

describe('worktrees & branches (integration)', () => {
  let repo: string;
  let linked: string;

  beforeAll(async () => {
    repo = await mkdtemp(path.join(tmpdir(), 'supervision-git-'));
    await git(repo, [
      'init',
      '-b',
      'main',
    ]);
    await git(repo, [
      'config',
      'user.email',
      'test@example.com',
    ]);
    await git(repo, [
      'config',
      'user.name',
      'Test',
    ]);
    await Bun.write(path.join(repo, 'a.txt'), 'a\n');
    await git(repo, [
      'add',
      '.',
    ]);
    await git(repo, [
      'commit',
      '-m',
      'init',
    ]);
    await git(repo, [
      'branch',
      'idle',
    ]);
    linked = path.join(repo, '.worktrees', 'task');
    await git(repo, [
      'worktree',
      'add',
      '-b',
      'feature',
      linked,
    ]);
  });

  afterAll(async () => {
    await rm(repo, {
      recursive: true,
      force: true,
    });
  });

  test('WTL-3: listWorktrees sees both checkouts and flags the current one', async () => {
    const fromLinked = await listWorktrees(linked);
    expect(
      fromLinked.map((worktree) => [
        worktree.main,
        worktree.current,
        worktree.branch,
      ]),
    ).toEqual([
      [
        true,
        false,
        'main',
      ],
      [
        false,
        true,
        'feature',
      ],
    ]);
  });

  test('BRL-1: listBranches marks current and other-worktree checkouts', async () => {
    const branches = await listBranches(repo);
    const byName = new Map(
      branches.map((branch) => [
        branch.name,
        branch,
      ]),
    );
    expect(byName.get('main')?.current).toBe(true);
    expect(byName.get('main')?.worktree).toBeNull();
    expect(byName.get('feature')?.current).toBe(false);
    expect(byName.get('feature')?.worktree).toContain('.worktrees/task');
    expect(byName.get('idle')?.worktree).toBeNull();
  });

  test('BRL-2: switchBranch checks out a free branch and refuses a held one', async () => {
    expect(await switchBranch(repo, 'idle')).toEqual({
      ok: true,
    });
    const held = await switchBranch(repo, 'feature');
    expect(held.ok).toBe(false);
    expect(held.error).toContain('feature');
    await switchBranch(repo, 'main');
  });
});
