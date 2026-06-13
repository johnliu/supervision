// Platform facade: the seam between the UI (store) and whatever backend serves
// the SupervisionRPC contract. Three backends implement it:
//   - platform/electrobun.ts — the desktop app (wraps ./rpc, Electrobun RPC)
//   - platform/live.ts       — a plain-WS bridge to the Bun handlers (web mode)
//   - web/backend.ts         — in-memory fixtures (web mode, tests)
//
// Each entry point (main.tsx, web/main.tsx) calls setPlatform() exactly once in
// its module body, before React mounts. The store registers its push-event
// handlers at module-evaluation time — before any setPlatform — so
// registrations are buffered and flushed when the backend arrives. `api` is a
// call-time-resolving proxy, so no module ever holds a reference to a specific
// backend's method.

import type { SupervisionRPC } from '../shared/rpc';

type BunRequests = SupervisionRPC['bun']['requests'];

/** The typed request surface, shaped exactly like electrobun's request proxy
 * (RPCRequestsProxy) so the desktop backend can pass `rpc.request` through. */
export type SupervisionApi = {
  [K in keyof BunRequests]: (
    ...args: undefined extends BunRequests[K]['params']
      ? [
          params?: BunRequests[K]['params'],
        ]
      : [
          params: BunRequests[K]['params'],
        ]
  ) => Promise<BunRequests[K]['response']>;
};

export interface RepoChangedInfo {
  root: string;
  recents: string[];
}

export interface PlatformBackend {
  api: SupervisionApi;
  onWorkingTreeChanged(cb: () => void): void;
  onMenuAction(cb: (action: string) => void): void;
  onRepoChanged(cb: (info: RepoChangedInfo) => void): void;
  /** Mirror UI state into the native menu (no-op on backends without one). */
  sendMenuState?(state: { exportEnabled: boolean }): void;
}

let backend: PlatformBackend | null = null;

// Registrations made before setPlatform (the store registers at module scope).
const pending: Array<(b: PlatformBackend) => void> = [];

export function setPlatform(next: PlatformBackend): void {
  if (backend) {
    throw new Error('setPlatform: a platform backend is already installed');
  }
  backend = next;
  for (const flush of pending) {
    flush(next);
  }
  pending.length = 0;
}

function withBackend(register: (b: PlatformBackend) => void): void {
  if (backend) {
    register(backend);
  } else {
    pending.push(register);
  }
}

export function onWorkingTreeChanged(cb: () => void): void {
  withBackend((b) => b.onWorkingTreeChanged(cb));
}

export function onMenuAction(cb: (action: string) => void): void {
  withBackend((b) => b.onMenuAction(cb));
}

export function onRepoChanged(cb: (info: RepoChangedInfo) => void): void {
  withBackend((b) => b.onRepoChanged(cb));
}

/** Mirror UI state into the native menu. Dropped (not buffered) when no
 * backend is installed yet — the store re-pushes on every comments change. */
export function sendMenuState(state: { exportEnabled: boolean }): void {
  backend?.sendMenuState?.(state);
}

/** Request proxy resolving the active backend at call time. Calling before
 * setPlatform is a programming error (entries install the backend before
 * React mounts, and requests only happen from post-mount effects). */
export const api: SupervisionApi = new Proxy({} as SupervisionApi, {
  get(_target, method: string) {
    return (...args: unknown[]) => {
      if (!backend) {
        return Promise.reject(new Error(`platform.api.${method} called before setPlatform() — no backend installed`));
      }
      const fn = backend.api[method as keyof SupervisionApi] as (...inner: unknown[]) => Promise<unknown>;
      return fn(...args);
    };
  },
});
