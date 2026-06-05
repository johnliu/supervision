// Webview side of the typed RPC. Constructs the Electroview, exposes the typed
// request proxy as `api`, and lets the app subscribe to bun-pushed messages.

import { Electroview } from 'electrobun/view';
import type { SupervisionRPC } from '../shared/rpc';

let workingTreeChangedHandler: (() => void) | null = null;

/** Register a callback fired when Bun reports the working tree changed. */
export function onWorkingTreeChanged(cb: () => void): void {
  workingTreeChangedHandler = cb;
}

const rpc = Electroview.defineRPC<SupervisionRPC>({
  handlers: {
    messages: {
      workingTreeChanged: () => {
        workingTreeChangedHandler?.();
      },
    },
  },
});

// Exported to keep the instance (and its socket) alive for the app's lifetime.
export const electroview = new Electroview({
  rpc,
});

/** Typed request proxy: `api.getReview(...)`, `api.stage(...)`, etc. */
export const api = rpc.request;
