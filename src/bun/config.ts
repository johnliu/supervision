// User preferences persisted to `.supervision/config.json` at the repo root
// (alongside comments.json). Missing or malformed config falls back to defaults.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DEFAULTS, clampEditor, clampFontSize } from '../shared/config';
import type { SupervisionConfig } from '../shared/types';

function configPath(repoRoot: string): string {
  return path.join(repoRoot, '.supervision', 'config.json');
}

export async function readConfig(repoRoot: string): Promise<SupervisionConfig> {
  const file = Bun.file(configPath(repoRoot));
  if (!(await file.exists())) {
    return {
      ...CONFIG_DEFAULTS,
    };
  }
  try {
    const data = (await file.json()) as Partial<SupervisionConfig>;
    return {
      diffStyle: data.diffStyle === 'unified' ? 'unified' : 'split',
      ignoreWhitespace: data.ignoreWhitespace !== false,
      lineWrap: data.lineWrap === true,
      fontSize: clampFontSize(data.fontSize),
      editor: clampEditor(data.editor),
    };
  } catch {
    return {
      ...CONFIG_DEFAULTS,
    };
  }
}

export async function writeConfig(repoRoot: string, config: SupervisionConfig): Promise<SupervisionConfig> {
  await mkdir(path.join(repoRoot, '.supervision'), {
    recursive: true,
  });
  await Bun.write(configPath(repoRoot), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
