// User preferences, persisted app-wide at `~/.supervision/config.json`
// (alongside recent.json) — view settings follow the user, not the repo.
// Settings briefly lived per-repo at `<repo>/.supervision/config.json`; the
// first read seeds the user file from that location when it exists, so
// nothing resets on upgrade. Missing or malformed config falls back to
// defaults.

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  CONFIG_DEFAULTS,
  clampDiffTheme,
  clampEditor,
  clampFontSize,
  clampPalette,
  clampTheme,
} from '../shared/config';
import type { SupervisionConfig } from '../shared/types';

function configPath(): string {
  return path.join(homedir(), '.supervision', 'config.json');
}

function legacyConfigPath(repoRoot: string): string {
  return path.join(repoRoot, '.supervision', 'config.json');
}

function parseConfig(data: Partial<SupervisionConfig>): SupervisionConfig {
  return {
    diffStyle: data.diffStyle === 'unified' ? 'unified' : 'split',
    ignoreWhitespace: data.ignoreWhitespace !== false,
    lineWrap: data.lineWrap === true,
    fontSize: clampFontSize(data.fontSize),
    editor: clampEditor(data.editor),
    theme: clampTheme(data.theme),
    palette: clampPalette(data.palette),
    diffTheme: clampDiffTheme(data.diffTheme),
  };
}

/**
 * Read the user-level config. When the user file doesn't exist yet and the
 * current repo still has a legacy per-repo one, seed the user file from it
 * (one-time copy; the repo file is left alone — it may be checked in).
 */
export async function readConfig(repoRoot?: string): Promise<SupervisionConfig> {
  let file = Bun.file(configPath());
  let migrating = false;
  if (!(await file.exists())) {
    const legacy = repoRoot ? Bun.file(legacyConfigPath(repoRoot)) : null;
    if (!legacy || !(await legacy.exists())) {
      return {
        ...CONFIG_DEFAULTS,
      };
    }
    file = legacy;
    migrating = true;
  }
  try {
    const config = parseConfig((await file.json()) as Partial<SupervisionConfig>);
    if (migrating) {
      await writeConfig(config);
    }
    return config;
  } catch {
    return {
      ...CONFIG_DEFAULTS,
    };
  }
}

export async function writeConfig(config: SupervisionConfig): Promise<SupervisionConfig> {
  await mkdir(path.dirname(configPath()), {
    recursive: true,
  });
  await Bun.write(configPath(), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
