import { BrowserWindow, Updater } from 'electrobun/bun';
import { getRepoRoot } from './git';
import { createSupervisionRPC, getCurrentRepo } from './rpc';
import { watchWorkingTree } from './watcher';

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

// Create the main application window with the typed Supervision RPC attached.
const url = await getMainViewUrl();
const rpc = createSupervisionRPC();

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

// Watch the repo so LLM edits made after launch refresh the review automatically.
const repoRoot = await getRepoRoot(getCurrentRepo());
if (repoRoot) {
  watchWorkingTree(repoRoot, () => {
    rpc.send.workingTreeChanged();
  });
  console.log(`Watching ${repoRoot} for changes`);
} else {
  console.log(`No git repo at ${getCurrentRepo()}; file watching disabled`);
}

console.log('Supervision started!');
