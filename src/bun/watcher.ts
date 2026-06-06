// Debounced working-tree watcher. When files under the repo change (e.g. the
// LLM edits code), we coalesce the burst and fire a single callback, which the
// main process turns into a `workingTreeChanged` RPC message so the UI refetches
// the review.
//
// We only watch paths git would surface in a review. Two layers:
//   1. A synchronous ignore set, seeded once from git, keeps chokidar from ever
//      scanning or watching gitignored trees (node_modules/, .convex/,
//      convex/_generated/, .tanstack/, .env, …). This is what matters for
//      performance: a dev server churning a gitignored dir would otherwise flood
//      the watcher with events — and spawn a check-ignore subprocess per new
//      path — starving getReview and tripping the RPC timeout.
//   2. A cached `git check-ignore` backstop on each surviving event, so any
//      gitignored straggler not in the startup snapshot still can't trigger a
//      refresh. check-ignore is index-aware, so tracked files always count as
//      visible even if a pattern matches.

import path from 'node:path';
import { type FSWatcher, watch } from 'chokidar';
import { git } from './git';

// Special-cased by git (not reported by check-ignore) or so large that walking
// them at startup is wasteful even though git also ignores most of them.
const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'artifacts',
  '.supervision',
  '.DS_Store',
]);

/**
 * One-time snapshot of the paths git ignores, with fully-ignored directories
 * collapsed to the dir (via --directory). Returned as repo-relative paths with
 * any trailing slash stripped, e.g. ['.convex', 'convex/_generated', '.env'].
 * Synchronous so it can seed chokidar's `ignored` before the first scan.
 */
function loadIgnoredPaths(root: string): string[] {
  try {
    const res = Bun.spawnSync(
      [
        'git',
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '-z',
      ],
      {
        cwd: root,
      },
    );
    return res.stdout
      .toString()
      .split('\0')
      .map((p) => (p.endsWith('/') ? p.slice(0, -1) : p))
      .filter((p) => p.length > 0);
  } catch {
    return [];
  }
}

export interface WatchHandle {
  close: () => Promise<void>;
}

/**
 * Watch `root` and call `onChange` (debounced) on any add/change/delete to a
 * git-visible path. Gitignored paths are never watched (see module comment).
 */
export function watchWorkingTree(root: string, onChange: () => void, debounceMs = 200): WatchHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const ignoredPaths = loadIgnoredPaths(root);

  // Synchronous: a segment hits the structural list, or the path is (under) a
  // gitignored entry from the startup snapshot.
  const isIgnored = (rel: string): boolean => {
    if (rel.split(path.sep).some((segment) => IGNORED_SEGMENTS.has(segment))) {
      return true;
    }
    for (const entry of ignoredPaths) {
      if (rel === entry || rel.startsWith(`${entry}${path.sep}`)) {
        return true;
      }
    }
    return false;
  };

  // Repo-relative path, or null if `fullPath` is the root itself or outside it.
  const toRel = (fullPath: string): string | null => {
    const rel = path.relative(root, fullPath);
    return !rel || rel.startsWith('..') ? null : rel;
  };

  // `relPath -> is-gitignored`, the async backstop. `git check-ignore` is the
  // authority (honors nested .gitignore, .git/info/exclude, global excludes);
  // caching the promise memoizes and dedupes bursts from the same path.
  const ignoreCache = new Map<string, Promise<boolean>>();
  const isGitIgnored = (rel: string): Promise<boolean> => {
    let result = ignoreCache.get(rel);
    if (!result) {
      // on error, treat as visible (safe: we refresh)
      result = git(root, [
        'check-ignore',
        '-q',
        rel,
      ])
        .then((res) => res.exitCode === 0)
        .catch(() => false);
      ignoreCache.set(rel, result);
    }
    return result;
  };

  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    ignored: (fullPath: string) => {
      const rel = toRel(fullPath);
      return rel !== null && isIgnored(rel);
    },
  });

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };

  const handleEvent = async (fullPath: string) => {
    const rel = toRel(fullPath);
    if (rel === null) {
      schedule();
      return;
    }
    // Editing .gitignore can change what's ignored — drop the cache and refresh.
    if (path.basename(rel) === '.gitignore') {
      ignoreCache.clear();
      schedule();
      return;
    }
    if (await isGitIgnored(rel)) {
      return;
    }
    schedule();
  };

  // chokidar's FSWatcher is an EventEmitter at runtime, but under Bun's type
  // environment the inherited instance `.on` doesn't resolve (TS sees only the
  // static). Subscribe through a minimal structural type. Each listener receives
  // the changed path.
  const emitter = watcher as unknown as {
    on: (event: string, listener: (changedPath: string) => void) => void;
  };
  for (const event of [
    'add',
    'change',
    'unlink',
    'addDir',
    'unlinkDir',
  ] as const) {
    emitter.on(event, handleEvent);
  }

  return {
    close: async () => {
      if (timer) {
        clearTimeout(timer);
      }
      await watcher.close();
    },
  };
}
