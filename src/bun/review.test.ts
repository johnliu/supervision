// The diff pipeline: getReview ships git's own patch (plus the full contents),
// and the client parses that with processFile instead of recomputing the diff in
// JS. These tests pin the contract the renderer depends on — a non-partial
// FileDiff with accurate line counts — and guard the performance fix: a
// heavily-changed large file must parse from git's patch in milliseconds, where
// the old client-side parseDiffFromFile blew up into seconds.

import { processFile } from '@pierre/diffs';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getReview } from './git';

const git = (cwd: string, args: string[]) => Bun.spawnSync(['git', ...args], { cwd });

/** Parse a FileChange the way DiffPane does: git's patch + the full contents. */
function parse(file: { patch: string; oldContents: string; newContents: string; path: string }) {
  return processFile(file.patch, {
    isGitDiff: true,
    oldFile: {
      name: file.path,
      contents: file.oldContents,
    },
    newFile: {
      name: file.path,
      contents: file.newContents,
    },
  });
}

describe('getReview diff pipeline', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sv-review-'));
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 't@example.com']);
    git(root, ['config', 'user.name', 'Tester']);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const lines = (n: number, tag = '') =>
    Array.from({ length: n }, (_, i) => `const x${i} = compute(${i});${tag}`).join('\n');

  test('REVIEW-1: a tracked change ships a patch + contents that parse non-partial', async () => {
    writeFileSync(path.join(root, 'a.ts'), `${lines(40)}\n`);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'base']);
    writeFileSync(path.join(root, 'a.ts'), `${lines(40).replace('compute(5)', 'compute(500)')}\n`);

    const model = await getReview(root, { kind: 'working' }, false);
    const file = model.unreviewed.find((f) => f.path === 'a.ts');
    expect(file).toBeDefined();
    expect(file?.patch).toContain('@@');
    expect(file?.newContents).toContain('compute(500)');

    const fd = parse(file!);
    // Non-partial is what unlocks collapse/expand in the renderer.
    expect(fd?.isPartial).toBe(false);
    // additionLines is the whole new file when non-partial: 40 lines.
    expect(fd?.additionLines.length).toBe(40);
    expect(fd?.hunks.length).toBeGreaterThan(0);
  });

  test('REVIEW-2: an untracked file ships an all-additions patch', async () => {
    writeFileSync(path.join(root, 'new.ts'), `${lines(10)}\n`);
    const model = await getReview(root, { kind: 'working' }, false);
    const file = model.unreviewed.find((f) => f.path === 'new.ts');
    expect(file?.untracked).toBe(true);
    expect(file?.oldContents).toBe('');
    const fd = parse(file!);
    expect(fd?.isPartial).toBe(false);
    expect(fd?.additionLines.length).toBe(10);
  });

  test('REVIEW-3: a heavily-changed large file parses in milliseconds (no JS Myers blowup)', async () => {
    // Every line differs — the worst case that made client-side parseDiffFromFile
    // take many seconds. git computes the patch in C; processFile parses linearly.
    writeFileSync(path.join(root, 'big.ts'), `${lines(8000, ' // old')}\n`);
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'base']);
    writeFileSync(path.join(root, 'big.ts'), `${lines(8000, ' // new')}\n`);

    const model = await getReview(root, { kind: 'working' }, false);
    const file = model.unreviewed.find((f) => f.path === 'big.ts');
    expect(file).toBeDefined();

    const t0 = performance.now();
    const fd = parse(file!);
    const elapsed = performance.now() - t0;

    expect(fd?.isPartial).toBe(false);
    expect(fd?.additionLines.length).toBe(8000);
    // Generous bound: the git-patch path is ~10ms here; the old JS diff was
    // several seconds for this input. Anything sub-second proves we're not on it.
    expect(elapsed).toBeLessThan(800);
  });

  test('REVIEW-4: files default to unread when nothing is marked read', async () => {
    writeFileSync(path.join(root, 'new.ts'), `${lines(10)}\n`);
    const model = await getReview(root, { kind: 'working' }, false);
    expect(model.unreviewed.find((f) => f.path === 'new.ts')?.read).toBe(false);
  });
});
