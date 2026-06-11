// Headless web-mode entry: the real Bun backend (git, comments, config,
// watcher) behind the plain-WS bridge — zero Electrobun. Run via
// `bun run web` together with the Vite dev server; the browser app at
// /web.html?backend=live then reviews a real repo.
//
// Repo selection matches the desktop app: SUPERVISION_REPO env override,
// else the launch cwd's git root.

import { getRepoRoot } from './git';
import { createSupervisionHandlers } from './handlers';
import { type WatchHandle, watchWorkingTree } from './watcher';
import { startWebBridge } from './webBridge';

const PORT = Number(process.env.SUPERVISION_BRIDGE_PORT ?? 5178);

let watchHandle: WatchHandle | null = null;
function rewatch(root: string | null): void {
  if (watchHandle) {
    void watchHandle.close();
    watchHandle = null;
  }
  if (root) {
    watchHandle = watchWorkingTree(root, () => {
      bridge.broadcast('workingTreeChanged');
    });
    console.log(`Watching ${root} for changes`);
  } else {
    console.log('No git repo; file watching disabled');
  }
}

const { handlers, getCurrentRepo } = createSupervisionHandlers({
  onRepoChanged: (info) => {
    rewatch(info.root);
    bridge.broadcast('repoChanged', info);
  },
  // No native ops: openProject reports cancelled (use recents / setRepo);
  // exportMarkdown returns the markdown and the browser copies it.
});

const bridge = startWebBridge({
  port: PORT,
  handlers,
});

const initialRoot = await getRepoRoot(getCurrentRepo());
rewatch(initialRoot);

console.log(`Supervision web bridge: ws://localhost:${PORT}/socket`);
console.log(`Reviewing: ${initialRoot ?? `${getCurrentRepo()} (not a git repo)`}`);
console.log('Open the app: /web.html?backend=live (vite dev server)');
