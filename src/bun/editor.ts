// Open a file (optionally at a line) in the editor the user picked in
// settings. The editor's CLI is resolved against an augmented PATH — apps
// launched from the Finder/Dock inherit a minimal one without /usr/local/bin
// or /opt/homebrew/bin, which is exactly where editor CLI shims live. When
// the shim isn't installed at all, fall back to `open -a <App>` (loses the
// line number but still lands in the right editor).

import { join } from 'node:path';
import { EDITORS } from '../shared/config';
import type { EditorId } from '../shared/types';

const CLI_PATH = [
  process.env.PATH,
  '/usr/local/bin',
  '/opt/homebrew/bin',
]
  .filter(Boolean)
  .join(':');

const defaultWhich = (cmd: string): string | null =>
  Bun.which(cmd, {
    PATH: CLI_PATH,
  });

/** The argv to spawn for `editorId`, given a `which` resolver (injectable for tests). */
export function resolveEditorCommand(
  editorId: EditorId,
  file: string,
  line: number | undefined,
  which: (cmd: string) => string | null = defaultWhich,
): string[] {
  const spec = EDITORS.find((editor) => editor.id === editorId);
  if (!spec || spec.id === 'open' || !spec.app) {
    return [
      'open',
      file,
    ];
  }
  const cli = which(spec.id);
  if (!cli) {
    return [
      'open',
      '-a',
      spec.app,
      file,
    ];
  }
  const target = line ? `${file}:${line}` : file;
  // The VS Code family wants --goto; zed/subl take file:line directly.
  return spec.id === 'code' || spec.id === 'cursor'
    ? [
        cli,
        '--goto',
        target,
      ]
    : [
        cli,
        target,
      ];
}

export function openInEditor(
  repoRoot: string,
  relPath: string,
  line: number | undefined,
  editorId: EditorId,
): {
  ok: boolean;
  error?: string;
} {
  try {
    Bun.spawn(resolveEditorCommand(editorId, join(repoRoot, relPath), line));
    return {
      ok: true,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error),
    };
  }
}
