// Where the app points on launch: the first CLI argument that names an
// existing directory (`supervision <dir>`), else SUPERVISION_REPO (set by the
// bin/supervision wrapper and parallel-session tooling), else the launch cwd.

import { statSync } from 'node:fs';
import path from 'node:path';

export function resolveLaunchRepo(
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): string {
  // argv[0]=bun, argv[1]=entry script; anything after may include launcher
  // noise (e.g. macOS -psn_* flags), so only accept real directories.
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('-')) {
      continue;
    }
    try {
      const resolved = path.resolve(arg);
      if (statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // Not an existing path — ignore.
    }
  }
  return env.SUPERVISION_REPO ?? process.cwd();
}
