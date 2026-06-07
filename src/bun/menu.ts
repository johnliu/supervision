// Native application menu. Standard roles (Edit) give the webview real
// cut/copy/paste/undo in the comment composer; action items are routed to the
// webview via the `menuAction` RPC message, where the store dispatches them.
// Cmd-accelerators live here (not in the webview hook) so macOS dispatches them
// even when the webview would otherwise swallow the key (e.g. Cmd+Shift+]).

import { ApplicationMenu } from 'electrobun/bun';
import type { SupervisionRpcInstance } from './rpc';

export function setupApplicationMenu(rpc: SupervisionRpcInstance): void {
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
        },
        {
          type: 'separator',
        },
        {
          label: 'Quit Supervision',
          role: 'quit',
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
          label: 'Export for LLM',
          action: 'export',
          accelerator: 'CommandOrControl+Shift+E',
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
  ]);

  ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
    const action = (
      event as {
        data?: {
          action?: string;
        };
      }
    )?.data?.action;
    if (action) {
      rpc.send.menuAction({
        action,
      });
    }
  });
}
