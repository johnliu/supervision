// Recently-opened repos, persisted app-wide (not per-repo) at
// `~/.supervision/recent.json`. This is a cross-project list, so it lives in the
// user's home rather than any one repo's `.supervision/` dir. Newest first,
// de-duplicated, capped at MAX_RECENT.

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const MAX_RECENT = 10;

function recentPath(): string {
  return path.join(homedir(), '.supervision', 'recent.json');
}

export async function readRecentProjects(): Promise<string[]> {
  const file = Bun.file(recentPath());
  if (!(await file.exists())) {
    return [];
  }
  try {
    const data = await file.json();
    return Array.isArray(data) ? data.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** Move `repoPath` to the front and persist; returns the updated list. */
export async function addRecentProject(repoPath: string): Promise<string[]> {
  const existing = await readRecentProjects();
  const next = [
    repoPath,
    ...existing.filter((entry) => entry !== repoPath),
  ].slice(0, MAX_RECENT);
  try {
    await mkdir(path.dirname(recentPath()), {
      recursive: true,
    });
    await Bun.write(recentPath(), `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    console.error('Failed to write recent projects', error);
  }
  return next;
}
