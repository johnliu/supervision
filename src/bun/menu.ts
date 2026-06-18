// Native application menu. Standard roles (Edit) give the webview real
// cut/copy/paste/undo in the comment composer; action items are routed to the
// webview via the `menuAction` RPC message, where the store dispatches them.
// Cmd-accelerators live here (not in the webview hook) so macOS dispatches them
// even when the webview would otherwise swallow the key (e.g. Cmd+Shift+]).

import { ApplicationMenu } from 'electrobun/bun';
import type { SupervisionRpcInstance } from './rpc';

export interface ApplicationMenuOptions {
  /** Toggle the webview's developer tools — a window op, handled Bun-side
   * rather than routed to the webview like the other menu actions. */
  onToggleDevTools?: () => void;
}

export interface ApplicationMenuHandle {
  /** Enable/disable "Copy Comments for LLM" — mirrors the toolbar button,
   * which is disabled while there are no open comments. Rebuilds the menu
   * (Electrobun has no per-item update API). */
  setExportEnabled(enabled: boolean): void;
}

function buildMenu(state: { exportEnabled: boolean }): void {
  ApplicationMenu.setApplicationMenu([
    {
      label: 'Supervision',
      submenu: [
        {
          label: 'About Supervision',
          role: 'about',
        },
        {
          type: 'separator',
        },
        {
          label: 'Settings…',
          action: 'settings',
          accelerator: 'CommandOrControl+,',
        },
        {
          type: 'separator',
        },
        {
          label: 'Hide Supervision',
          role: 'hide',
          accelerator: 'CommandOrControl+H',
        },
        {
          type: 'separator',
        },
        {
          label: 'Quit Supervision',
          role: 'quit',
          accelerator: 'CommandOrControl+Q',
        },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project…',
          action: 'open-project',
          accelerator: 'CommandOrControl+O',
        },
        {
          type: 'separator',
        },
        {
          label: 'Refresh',
          action: 'refresh',
          accelerator: 'CommandOrControl+R',
        },
        {
          // Mirrors the toolbar's copy-comments button (label and enabled
          // state); the store routes the action to the same exportReview.
          label: 'Copy Comments for LLM',
          action: 'export',
          accelerator: 'CommandOrControl+Shift+E',
          enabled: state.exportEnabled,
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          role: 'undo',
        },
        {
          label: 'Redo',
          role: 'redo',
        },
        {
          type: 'separator',
        },
        {
          label: 'Cut',
          role: 'cut',
        },
        {
          label: 'Copy',
          role: 'copy',
        },
        {
          label: 'Paste',
          role: 'paste',
        },
        {
          label: 'Select All',
          role: 'selectAll',
        },
        {
          type: 'separator',
        },
        {
          // Opens the in-content find bar; searches the visible text of
          // whatever mode is showing (diff, commit, markdown, …).
          label: 'Find…',
          action: 'search:open',
          accelerator: 'CommandOrControl+F',
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Split View',
          action: 'view:split',
        },
        {
          label: 'Unified View',
          action: 'view:unified',
        },
        {
          type: 'separator',
        },
        {
          label: 'Ignore Whitespace',
          action: 'view:toggle-whitespace',
          accelerator: 'CommandOrControl+Shift+W',
        },
        {
          type: 'separator',
        },
        {
          label: 'Toggle Developer Tools',
          action: 'devtools',
          accelerator: 'CommandOrControl+Alt+I',
        },
      ],
    },
    {
      label: 'Go',
      submenu: [
        {
          label: 'Quick Open…',
          action: 'go:quick-open',
          accelerator: 'CommandOrControl+K',
        },
        {
          type: 'separator',
        },
        {
          label: 'Next File',
          action: 'go:next-file',
          accelerator: 'CommandOrControl+Shift+]',
        },
        {
          label: 'Previous File',
          action: 'go:prev-file',
          accelerator: 'CommandOrControl+Shift+[',
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          action: 'help:shortcuts',
          accelerator: 'CommandOrControl+/',
        },
      ],
    },
  ]);
}

export function setupApplicationMenu(
  rpc: SupervisionRpcInstance,
  options: ApplicationMenuOptions = {},
): ApplicationMenuHandle {
  // Nothing to copy until the webview reports open comments.
  const state = {
    exportEnabled: false,
  };
  buildMenu(state);

  ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
    const action = (
      event as {
        data?: {
          action?: string;
        };
      }
    )?.data?.action;
    if (!action) {
      return;
    }
    // Dev tools is a window/webview operation, handled here rather than routed
    // to the webview like the other actions.
    if (action === 'devtools') {
      options.onToggleDevTools?.();
      return;
    }
    rpc.send.menuAction({
      action,
    });
  });

  return {
    setExportEnabled: (enabled) => {
      if (enabled !== state.exportEnabled) {
        state.exportEnabled = enabled;
        buildMenu(state);
      }
    },
  };
}
