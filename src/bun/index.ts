import { BrowserWindow, Updater } from 'electrobun/bun';
import { createSupervisionRPC } from './rpc';

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

// Kept for the Phase 3 working-tree watcher, which will push
// `rpc.send.workingTreeChanged()` to the webview on file changes.
export { mainWindow, rpc };

console.log('Supervision started!');
