import { BrowserWindow, Updater } from 'electrobun/bun';
import { getRepoRoot } from './git';
import { setupApplicationMenu } from './menu';
import { addRecentProject } from './recent';
import { createSupervisionRPC, getCurrentRepo } from './rpc';
import { type WatchHandle, watchWorkingTree } from './watcher';

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === 'dev') {
    try {
      await fetch(DEV_SERVER_URL, {
        method: 'HEAD',
      });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
    }
  }
  return 'views://mainview/index.html';
}

// Watch the repo so LLM edits made after launch refresh the review automatically.
// Held here (not in the watcher) so a project switch can stop the old watcher
// and start one on the new root.
let watchHandle: WatchHandle | null = null;
function rewatch(root: string | null): void {
  if (watchHandle) {
    void watchHandle.close();
    watchHandle = null;
  }
  if (root) {
    watchHandle = watchWorkingTree(root, () => {
      rpc.send.workingTreeChanged();
    });
    console.log(`Watching ${root} for changes`);
  } else {
    console.log('No git repo; file watching disabled');
  }
}

// Create the main application window with the typed Supervision RPC attached.
const url = await getMainViewUrl();
const rpc = createSupervisionRPC({
  onRepoChanged: ({ root, recents }) => {
    rewatch(root);
    // Push instead of relying on the RPC return — the native folder dialog can
    // outlive the request timeout, so the webview learns of the switch here.
    rpc.send.repoChanged({
      root,
      recents,
    });
  },
});

const mainWindow = new BrowserWindow({
  title: 'Supervision',
  url,
  frame: {
    width: 1400,
    height: 900,
    x: 100,
    y: 100,
  },
  rpc,
});

export { mainWindow, rpc };

// Native menu bar; menu clicks are routed to the webview over `rpc` (except
// dev tools, which toggles the window's webview inspector directly).
setupApplicationMenu(rpc, {
  onToggleDevTools: () => mainWindow.webview?.toggleDevTools(),
});

const initialRoot = await getRepoRoot(getCurrentRepo());
rewatch(initialRoot);
// Seed the launch repo into the recents list so the switcher can return to it
// after the user opens a different project.
if (initialRoot) {
  void addRecentProject(initialRoot);
}

console.log('Supervision started!');
