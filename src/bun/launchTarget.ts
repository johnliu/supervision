// Where the app points on launch. Explicit intent wins: the first CLI argument
// that names an existing directory (`supervision <dir>`), else SUPERVISION_REPO
// (set by the bin/supervision wrapper and parallel-session tooling).
//
// With no explicit target — a bare launch (Finder, the Dock, `supervision` with
// no args) — fall back to the launch cwd ONLY when it is a git repo (dev, or a
// terminal sitting inside a checkout), else the most recently opened project
// (the last directory the user reviewed), else nothing (the app shows its
// empty state). The cwd is deliberately NOT a blind fallback: launched from
// Finder it is the app bundle's own Contents/MacOS directory, which is never a
// repo and must never be "opened".

import { statSync } from 'node:fs';
import path from 'node:path';

/**
 * The explicitly requested repo, or null when the launch carries no target. A
 * positional directory argument wins over SUPERVISION_REPO; launcher noise
 * (macOS -psn_* flags, non-directory arguments) is ignored.
 */
export function resolveExplicitRepo(
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): string | null {
  // argv[0]=bun, argv[1]=entry script; anything after may include launcher
  // noise, so only accept real directories.
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
  return env.SUPERVISION_REPO ?? null;
}

export interface InitialRepoDeps {
  /** True when `dir` resolves to a git working tree. */
  isRepo: (dir: string) => Promise<boolean>;
  /** Recently-opened project roots, newest first (raw recent.json order). */
  readRecents: () => Promise<string[]>;
  argv?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
}

/**
 * The repo to open on launch, or null for "no project". Resolution order:
 *   1. an explicit target (CLI directory / SUPERVISION_REPO) — honored as-is,
 *      even when it is not a repo, so `supervision /not-a-repo` still surfaces
 *      the not-a-repo error rather than silently opening something else.
 *   2. the launch cwd, when it is a git repo (dev, or a terminal in a checkout).
 *   3. the most recent project that still resolves to a repo (last opened).
 *   4. null — there is nothing to open.
 */
export async function resolveInitialRepo(deps: InitialRepoDeps): Promise<string | null> {
  const argv = deps.argv ?? process.argv;
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();

  const explicit = resolveExplicitRepo(argv, env);
  if (explicit) {
    return explicit;
  }

  if (await deps.isRepo(cwd)) {
    return cwd;
  }

  for (const entry of await deps.readRecents()) {
    if (await deps.isRepo(entry)) {
      return entry;
    }
  }

  return null;
}
