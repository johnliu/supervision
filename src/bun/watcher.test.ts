// Working-tree watcher: the debounced refresh fires for git-visible changes and
// stays silent for gitignored ones — including the load-bearing case of a
// gitignored directory that appears AFTER startup (a dev server's build/cache
// output). Before layer 1b, such a tree was watched and walked, and every
// churned file spawned a `git check-ignore` — pegging the CPU even though no
// refresh ever fired. The prune test guards that regression: the subtree must be
// unwatched, not merely suppressed per-file.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type WatchHandle, watchWorkingTree } from './watcher';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// chokidar's fs.watch pickup is asynchronous; poll instead of guessing a delay.
async function waitFor(pred: () => boolean, timeout = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred()) {
      return true;
    }
    await sleep(25);
  }
  return pred();
}

const git = (cwd: string, args: string[]) =>
  Bun.spawnSync(
    [
      'git',
      ...args,
    ],
    {
      cwd,
    },
  );

describe('watchWorkingTree', () => {
  let root: string;
  let handle: WatchHandle | null = null;
  let changes = 0;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sv-watch-'));
    git(root, [
      'init',
      '-q',
    ]);
    git(root, [
      'config',
      'user.email',
      't@example.com',
    ]);
    git(root, [
      'config',
      'user.name',
      'Tester',
    ]);
    // A committed, visible file so the repo has a tracked baseline at startup.
    writeFileSync(path.join(root, '.gitignore'), 'buildcache/\n');
    writeFileSync(path.join(root, 'README.md'), 'hi\n');
    git(root, [
      'add',
      '.',
    ]);
    git(root, [
      'commit',
      '-qm',
      'init',
    ]);
    changes = 0;
    handle = watchWorkingTree(
      root,
      () => {
        changes++;
      },
      40,
    );
    // Let chokidar finish its initial scan before we start mutating.
    await sleep(400);
  });

  afterEach(async () => {
    await handle?.close();
    handle = null;
    await rm(root, {
      recursive: true,
      force: true,
    });
  });

  test('WATCH-1: a git-visible change fires the debounced refresh', async () => {
    writeFileSync(path.join(root, 'README.md'), 'changed\n');
    expect(await waitFor(() => changes > 0)).toBe(true);
  });

  test('WATCH-2: a visible new directory refreshes', async () => {
    const dir = path.join(root, 'feature');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'a.ts'), 'export {};\n');
    expect(await waitFor(() => changes > 0)).toBe(true);
  });

  test('WATCH-3: a post-startup gitignored dir is pruned, not churned', async () => {
    const dir = path.join(root, 'buildcache');
    mkdirSync(dir);
    // Let chokidar discover the new dir; the prune (one check-ignore + unwatch)
    // happens on its `addDir`. Settle so the async unwatch has landed before we
    // churn (the count flips synchronously, slightly ahead of the unwatch).
    expect(await waitFor(() => (handle?.checkIgnoreCount() ?? 0) > 0)).toBe(true);
    await sleep(300);
    const afterPrune = handle?.checkIgnoreCount() ?? 0;

    // Now simulate a dev server churning unique-named output into the cache dir.
    // Unpruned this is a check-ignore (subprocess) per file — the CPU storm.
    for (let i = 0; i < 200; i++) {
      writeFileSync(path.join(dir, `chunk.${i}.${i * 7}.js`), 'x');
    }
    await sleep(600);

    // No refresh: churning a gitignored tree must never wake the UI.
    expect(changes).toBe(0);
    // And the churn must cost ~nothing: the subtree is unwatched, so the 200
    // writes spawn no new check-ignores (a small slack covers event timing).
    expect((handle?.checkIgnoreCount() ?? 0) - afterPrune).toBeLessThanOrEqual(5);
  });
});
