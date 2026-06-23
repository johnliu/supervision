import { BrowserWindow, Updater } from 'electrobun/bun';
import { getRepoRoot } from './git';
import { type ApplicationMenuHandle, setupApplicationMenu } from './menu';
import { addRecentProject } from './recent';
import { createSupervisionRPC, getCurrentRepo } from './rpc';
import { type WatchHandle, watchWorkingTree } from './watcher';
import { readWindowState, writeWindowState } from './windowState';

// Overridable so parallel worktree sessions don't attach to each other's
// Vite server (first one up owns 5173; others would load the wrong frontend).
const DEV_SERVER_PORT = Number(process.env.SUPERVISION_HMR_PORT ?? 5173);
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
// Assigned by setupApplicationMenu below; the webview can't push menu state
// before its first render, so the callback never fires while this is null.
let menu: ApplicationMenuHandle | null = null;
const rpc = createSupervisionRPC({
  onMenuStateChanged: ({ exportEnabled }) => menu?.setExportEnabled(exportEnabled),
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

// Window geometry persists across launches (~/.supervision/window.json) so the
// app reopens where the user left it. EXCEPTION: a parallel worktree session
// pins title/position via SUPERVISION_FRAME_* (identically titled windows
// stacked at the same coordinates are impossible to tell apart) — those are
// ephemeral, so they neither restore nor overwrite the main window's saved
// geometry.
const envFrameX = process.env.SUPERVISION_FRAME_X;
const envFrameY = process.env.SUPERVISION_FRAME_Y;
const pinnedFrame = envFrameX != null || envFrameY != null;
const savedWindow = pinnedFrame ? null : await readWindowState();

const mainWindow = new BrowserWindow({
  title: process.env.SUPERVISION_TITLE ?? 'Supervision',
  url,
  frame: {
    width: savedWindow?.width ?? 1400,
    height: savedWindow?.height ?? 900,
    x: savedWindow?.x ?? Number(envFrameX ?? 100),
    y: savedWindow?.y ?? Number(envFrameY ?? 100),
  },
  // Modern macOS chrome: transparent titlebar, traffic lights inset over the
  // content (the sidebar leaves room for them via .platform-desktop padding).
  // The offset moves the cluster from AppKit's plain-window default (9,9 on
  // Tahoe, probed) to (19,19) — where toolbar-style windows (Messages, the
  // Claude app) place it.
  titleBarStyle: 'hiddenInset',
  trafficLightOffset: {
    x: 10,
    y: 10,
  },
  rpc,
});

export { mainWindow, rpc };

// Persist geometry as the user moves/resizes, debounced to the gesture's end
// (both events fire continuously while dragging). Skipped for pinned parallel
// sessions so they don't overwrite the main window's saved state.
if (!pinnedFrame) {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistWindowState = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        void writeWindowState(mainWindow.getFrame());
      } catch {
        // The window may be tearing down (FFI frame read failed) — nothing to save.
      }
    }, 400);
  };
  mainWindow.on('resize', persistWindowState);
  mainWindow.on('move', persistWindowState);
}

// Native menu bar; menu clicks are routed to the webview over `rpc` (except
// dev tools, which toggles the window's webview inspector directly).
menu = setupApplicationMenu(rpc, {
  onToggleDevTools: () => mainWindow.webview?.toggleDevTools(),
});

const initialRepo = await getCurrentRepo();
const initialRoot = initialRepo ? await getRepoRoot(initialRepo) : null;
rewatch(initialRoot);
// Seed the launch repo into the recents list so the switcher can return to it
// after the user opens a different project.
if (initialRoot) {
  void addRecentProject(initialRoot);
}

console.log('Supervision started!');
