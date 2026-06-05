// Debounced working-tree watcher. When files under the repo change (e.g. the
// LLM edits code), we coalesce the burst and fire a single callback, which the
// main process turns into a `workingTreeChanged` RPC message so the UI refetches
// the review. Ignores VCS/build/dependency noise.

import path from 'node:path';
import { type FSWatcher, watch } from 'chokidar';

const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'artifacts',
  '.supervision',
  '.DS_Store',
]);

export interface WatchHandle {
  close: () => Promise<void>;
}

/**
 * Watch `root` and call `onChange` (debounced) on any add/change/delete. Paths
 * whose segments (relative to root) hit IGNORED_SEGMENTS are skipped, so e.g.
 * `node_modules` churn never triggers a refresh.
 */
export function watchWorkingTree(root: string, onChange: () => void, debounceMs = 200): WatchHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    ignored: (fullPath: string) => {
      const rel = path.relative(root, fullPath);
      if (!rel || rel.startsWith('..')) {
        return false;
      }
      return rel.split(path.sep).some((segment) => IGNORED_SEGMENTS.has(segment));
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

  // chokidar's FSWatcher is an EventEmitter at runtime, but under Bun's type
  // environment the inherited instance `.on` doesn't resolve (TS sees only the
  // static). Subscribe through a minimal structural type.
  const emitter = watcher as unknown as {
    on: (event: string, listener: () => void) => void;
  };
  for (const event of [
    'add',
    'change',
    'unlink',
    'addDir',
    'unlinkDir',
  ] as const) {
    emitter.on(event, schedule);
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
