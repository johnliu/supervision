// Bun side of the typed RPC: the Electrobun transport around the shared
// handler implementation (src/bun/handlers.ts). Native ops (folder picker,
// clipboard) are wired here — the web bridge transport runs the same handlers
// without them.

import { homedir } from 'node:os';
import path from 'node:path';
import { BrowserView, Utils } from 'electrobun/bun';
import type { SupervisionRPC } from '../shared/rpc';
import { createSupervisionHandlers, type SupervisionHandlersOptions } from './handlers';

let activeGetCurrentRepo: (() => Promise<string | null>) | null = null;

/** The repo under review, or null when no project is open. Async because the
 * handlers resolve it lazily (recents read + git probe) on first access. */
export async function getCurrentRepo(): Promise<string | null> {
  if (!activeGetCurrentRepo) {
    // Before createSupervisionRPC runs, fall back to the explicit override only.
    return process.env.SUPERVISION_REPO ?? null;
  }
  return activeGetCurrentRepo();
}

export type SupervisionRpcOptions = Pick<SupervisionHandlersOptions, 'onRepoChanged'> & {
  /** Webview-pushed menu mirror state (see SupervisionRPC bun.messages). */
  onMenuStateChanged?: (state: { exportEnabled: boolean }) => void;
};

export function createSupervisionRPC(options: SupervisionRpcOptions = {}) {
  const { handlers, getCurrentRepo: getRepo } = createSupervisionHandlers({
    onRepoChanged: options.onRepoChanged,
    native: {
      clipboardWriteText: (text) => Utils.clipboardWriteText(text),
      openFolderDialog: async (startingFolder) => {
        // Open beside the current repo (so a sibling is one click away); with
        // no project open, start at home.
        const picked = await Utils.openFileDialog({
          startingFolder: startingFolder ? path.dirname(startingFolder) : homedir(),
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return picked.find((entry) => entry.trim().length > 0) ?? null;
      },
    },
  });
  activeGetCurrentRepo = getRepo;

  return BrowserView.defineRPC<SupervisionRPC>({
    maxRequestTime: 30_000,
    handlers: {
      requests: handlers,
      messages: {
        menuStateChanged: (state) => options.onMenuStateChanged?.(state),
      },
    },
  });
}

export type SupervisionRpcInstance = ReturnType<typeof createSupervisionRPC>;
