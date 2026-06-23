// Persisted window geometry, app-wide at `~/.supervision/window.json` (next to
// recent.json and config.json). This is native-only state — the webview never
// sees it — so it lives outside the synced user config. Restored on launch and
// saved (debounced) as the window moves/resizes; see src/bun/index.ts.

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Floor the restored size so a persisted sliver (or a corrupt file) can't bring
// the window back unusably small.
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

function statePath(): string {
  return path.join(homedir(), '.supervision', 'window.json');
}

/** Validate persisted geometry: reject anything non-numeric, floor the size,
 * keep the position (a second display can sit at negative coordinates). */
export function sanitizeWindowState(value: unknown): WindowState | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { x, y, width, height } = value as Record<string, unknown>;
  if (
    ![
      x,
      y,
      width,
      height,
    ].every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return null;
  }
  // Position is kept as-is — a second display legitimately sits at negative
  // coordinates — and only the size is floored.
  return {
    x: x as number,
    y: y as number,
    width: Math.max(MIN_WIDTH, width as number),
    height: Math.max(MIN_HEIGHT, height as number),
  };
}

/** The saved geometry, or null when the file is absent or malformed. */
export async function readWindowState(): Promise<WindowState | null> {
  const file = Bun.file(statePath());
  if (!(await file.exists())) {
    return null;
  }
  try {
    return sanitizeWindowState(await file.json());
  } catch {
    return null;
  }
}

export async function writeWindowState(state: WindowState): Promise<void> {
  try {
    await mkdir(path.dirname(statePath()), {
      recursive: true,
    });
    await Bun.write(statePath(), `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    console.error('Failed to write window state', error);
  }
}
