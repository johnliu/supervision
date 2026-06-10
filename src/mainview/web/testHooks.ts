// Test hooks for web mode. Installed ONLY by web/main.tsx (gating by entry,
// not env checks), so the desktop bundle contains zero test code. Playwright
// reaches everything through window.__test.

import type { useReviewStore } from '../store';
import type { FixtureBackendHandle } from './backend';

export interface NavLogEntry {
  label: string;
  detail?: Record<string, unknown>;
  t: number;
}

export interface TestHooks {
  /** The zustand store hook — getState/setState/subscribe. */
  store: typeof useReviewStore;
  /** Snapshot of captured '[nav]' debug logs (DiffPane emits them by default). */
  navLogs(): NavLogEntry[];
  clearNavLogs(): void;
  backend: FixtureBackendHandle;
  /** Wait out the render/scroll pipeline: two animation frames + a macrotask. */
  settle(): Promise<void>;
  fixtureId: string;
}

declare global {
  interface Window {
    __test?: TestHooks;
  }
}

const NAV_LOG_CAP = 1000;

/** Wrap console.log to mirror '[nav] <label>' entries into a ring buffer with
 * their structured payloads. Must run before React renders so no log is lost.
 * Entries still reach the real console. */
function captureNavLogs(): {
  navLogs: () => NavLogEntry[];
  clearNavLogs: () => void;
} {
  const buffer: NavLogEntry[] = [];
  const original = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[nav] ')) {
      buffer.push({
        label: args[0].slice('[nav] '.length),
        detail: (args[1] ?? undefined) as Record<string, unknown> | undefined,
        t: performance.now(),
      });
      if (buffer.length > NAV_LOG_CAP) {
        buffer.splice(0, buffer.length - NAV_LOG_CAP);
      }
    }
    original(...args);
  };
  return {
    navLogs: () =>
      buffer.map((entry) => ({
        ...entry,
      })),
    clearNavLogs: () => {
      buffer.length = 0;
    },
  };
}

export function installTestHooks(params: {
  store: typeof useReviewStore;
  backend: FixtureBackendHandle;
  fixtureId: string;
}): void {
  const { navLogs, clearNavLogs } = captureNavLogs();
  window.__test = {
    store: params.store,
    navLogs,
    clearNavLogs,
    backend: params.backend,
    settle: () =>
      new Promise<void>((resolve) => {
        // rAF doesn't fire in hidden documents (and the diff renderer's own
        // pipeline stalls with it) — fall back to a timer so settle() never
        // hangs when the page is backgrounded.
        if (document.hidden) {
          setTimeout(resolve, 30);
          return;
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 0);
          });
        });
      }),
    fixtureId: params.fixtureId,
  };
}
