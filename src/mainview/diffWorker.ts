// Off-main-thread syntax highlighting for the diff viewer.
//
// @pierre/diffs can run its shiki tokenization in a Web Worker pool instead of
// on the UI thread. The diff PARSE (processFile) is already fast, but tokenizing
// a large file's lines can still cost tens-to-hundreds of ms on the main thread
// — enough to drop frames while a file loads. Routing it through a worker keeps
// the UI responsive no matter how big the file is.
//
// Vite's `?worker` suffix bundles pierre's worker entry (and its shiki deps)
// into a module worker. If the worker can't start — e.g. a webview that blocks
// module workers — the library detects the failed pool (`isWorkingPool()`) and
// falls back to synchronous main-thread highlighting, i.e. the prior behavior.
// So this is a pure upside with a built-in safety net.
import DiffHighlightWorker from '@pierre/diffs/worker/worker.js?worker';

/** One worker instance for the pool (pierre calls this once per pool slot). */
export const diffWorkerFactory = (): Worker => new DiffHighlightWorker();

// One file is visible at a time; a couple of workers cover the initial
// highlight plus a concurrent re-highlight on expand/theme-change without the
// default pool of eight idle threads.
export const DIFF_WORKER_POOL_SIZE = 2;
