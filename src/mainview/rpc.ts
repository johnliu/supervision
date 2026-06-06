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
  // Electrobun's default webview request timeout is just 1s
  // (DEFAULT_MAX_REQUEST_TIME), which getReview can exceed under startup
  // contention (the first render delays processing the response), surfacing as
  // "RPC request timed out." Raise it well past that.
  maxRequestTime: 30_000,
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
