// Open a file (optionally at a line) in the user's code editor. Discovery:
// SUPERVISION_EDITOR names a CLI; otherwise the first common editor CLI on
// PATH; otherwise macOS `open` with the system default app.

import { join } from 'node:path';

const CANDIDATES = [
  'cursor',
  'code',
  'zed',
  'subl',
];

/** CLIs in the VS Code family want `--goto file:line`; the rest take file:line. */
function editorArgs(editor: string, file: string, line?: number): string[] {
  const target = line ? `${file}:${line}` : file;
  return editor === 'code' || editor === 'cursor'
    ? [
        '--goto',
        target,
      ]
    : [
        target,
      ];
}

export function openInEditor(
  repoRoot: string,
  relPath: string,
  line?: number,
): {
  ok: boolean;
  error?: string;
} {
  const file = join(repoRoot, relPath);
  const editor = process.env.SUPERVISION_EDITOR ?? CANDIDATES.find((cmd) => Bun.which(cmd));
  try {
    if (editor && Bun.which(editor)) {
      Bun.spawn([
        editor,
        ...editorArgs(editor, file, line),
      ]);
    } else {
      Bun.spawn([
        'open',
        file,
      ]);
    }
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
