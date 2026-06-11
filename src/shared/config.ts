// Config defaults + validation shared by the Bun config reader and the
// settings UI, so a persisted value and a UI-entered value clamp identically.

import type { EditorId, SupervisionConfig } from './types';

export const CONFIG_DEFAULTS: SupervisionConfig = {
  diffStyle: 'split',
  ignoreWhitespace: true,
  lineWrap: false,
  fontSize: 13,
  editor: 'open',
};

/** Editors the settings dialog offers. `app` is the macOS application name
 * used as the `open -a` fallback when the editor's CLI shim isn't on PATH. */
export const EDITORS: Array<{
  id: EditorId;
  label: string;
  app?: string;
}> = [
  {
    id: 'open',
    label: 'System default',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    app: 'Cursor',
  },
  {
    id: 'code',
    label: 'VS Code',
    app: 'Visual Studio Code',
  },
  {
    id: 'zed',
    label: 'Zed',
    app: 'Zed',
  },
  {
    id: 'subl',
    label: 'Sublime Text',
    app: 'Sublime Text',
  },
];

/** Coerce a persisted editor id to a known one. */
export function clampEditor(value: unknown): EditorId {
  return EDITORS.some((editor) => editor.id === value) ? (value as EditorId) : CONFIG_DEFAULTS.editor;
}

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 20;

/** Standard sizes the toolbar button cycles through; the stepper (right-click
 * fine-tune, settings dialog) can land anywhere in MIN..MAX between them. */
export const FONT_SIZE_PRESETS = [
  11,
  12,
  13,
  14,
  16,
  18,
  20,
];

/** Coerce any persisted/entered font size to an integer pixel value in range. */
export function clampFontSize(value: unknown): number {
  const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : CONFIG_DEFAULTS.fontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
}
