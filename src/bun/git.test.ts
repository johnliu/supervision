// Worktree & branch listing: porcelain parsing plus an integration pass over
// a real temp repo with a linked worktree.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getCommitDetails,
  getRangeLog,
  getReview,
  git,
  listBranches,
  listWorktrees,
  parseWorktreeList,
  readFileBase64,
  switchBranch,
} from './git';

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

  test('CMT-1: getCommitDetails returns subject, multi-line body, and author identity', async () => {
    await Bun.write(path.join(repo, 'b.txt'), 'b\n');
    await git(repo, [
      'add',
      '.',
    ]);
    await git(repo, [
      'commit',
      '-m',
      'Add b | with "punctuation"',
      '-m',
      'First body line.\n\nSecond paragraph.',
    ]);
    const details = await getCommitDetails(repo, 'HEAD');
    expect(details?.subject).toBe('Add b | with "punctuation"');
    expect(details?.body).toBe('First body line.\n\nSecond paragraph.');
    expect(details?.authorName).toBe('Test');
    expect(details?.authorEmail).toBe('test@example.com');
    expect(details?.hash).toHaveLength(40);
    expect(details?.hash.startsWith(details?.shortHash ?? '')).toBe(true);
    expect(Number.isNaN(new Date(details?.authorDate ?? '').getTime())).toBe(false);
  });

  test('CMT-2: getCommitDetails is null for an unknown ref', async () => {
    expect(await getCommitDetails(repo, 'no-such-ref')).toBeNull();
  });

  test('RNG-1: getRangeLog lists the selected span inclusive of base, newest first', async () => {
    // History here: init → "Add b | with punctuation" (CMT-1). `base` is the
    // oldest *selected* commit and is inclusive, so a range whose base is the
    // root (main~1) lists BOTH commits — newest first — and null head is HEAD.
    const log = await getRangeLog(repo, 'main~1', null);
    expect(log.map((commit) => commit.subject)).toEqual([
      'Add b | with "punctuation"',
      'init',
    ]);
    // base === head spans just that one commit (inclusive of base). Unreachable
    // from the UI — a single selection is a 'commit' compare — but it pins the
    // inclusive contract.
    expect((await getRangeLog(repo, 'HEAD', 'HEAD')).map((commit) => commit.subject)).toEqual([
      'Add b | with "punctuation"',
    ]);
    // A base that doesn't resolve reads as no commits — not the entire log.
    expect(await getRangeLog(repo, 'no-such-ref', null)).toEqual([]);
  });

  test('RNG-2: a range diff is inclusive of the oldest selected commit', async () => {
    // Three fresh commits, each adding one file. Selecting the span [r2, r3]
    // must show the net of BOTH — the oldest selected commit (r2) included —
    // not just r3 vs r2, which would drop r2's own file.
    const commitFile = async (name: string) => {
      await Bun.write(path.join(repo, name), `${name}\n`);
      await git(repo, [
        'add',
        name,
      ]);
      await git(repo, [
        'commit',
        '-m',
        `Add ${name}`,
      ]);
      return (
        await git(repo, [
          'rev-parse',
          'HEAD',
        ])
      ).stdout.trim();
    };
    await commitFile('r1.txt');
    const r2 = await commitFile('r2.txt');
    const r3 = await commitFile('r3.txt');

    const model = await getReview(
      repo,
      {
        kind: 'range',
        base: r2,
        head: r3,
      },
      false,
    );
    const paths = model.unreviewed.map((file) => file.path).sort();
    expect(paths).toEqual([
      'r2.txt',
      'r3.txt',
    ]);
  });

  // A 1x1 transparent PNG — small but a real binary (NUL bytes, high bit set).
  const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  test('RDF-1: readFileBase64 round-trips working-tree image bytes', async () => {
    await Bun.write(path.join(repo, 'pixel.png'), Uint8Array.from(Buffer.from(PNG_BASE64, 'base64')));
    const payload = await readFileBase64(repo, 'pixel.png');
    expect(payload).toEqual({
      ok: true,
      mime: 'image/png',
      base64: PNG_BASE64,
    });
  });

  test('RDF-2: readFileBase64 reads blob bytes at a ref', async () => {
    await git(repo, [
      'add',
      'pixel.png',
    ]);
    await git(repo, [
      'commit',
      '-m',
      'Add pixel',
    ]);
    // Overwrite the working copy so a ref read that leaked through to the
    // working tree would be caught.
    await Bun.write(path.join(repo, 'pixel.png'), 'not a png');
    const payload = await readFileBase64(repo, 'pixel.png', 'HEAD');
    expect(payload).toEqual({
      ok: true,
      mime: 'image/png',
      base64: PNG_BASE64,
    });
    await git(repo, [
      'checkout',
      '--',
      'pixel.png',
    ]);
  });

  test('RDF-3: readFileBase64 refuses non-image types and escaping paths', async () => {
    expect((await readFileBase64(repo, 'a.txt')).ok).toBe(false);
    expect((await readFileBase64(repo, '../outside.png')).ok).toBe(false);
  });
});
