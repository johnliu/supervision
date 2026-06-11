// Config defaults + validation shared by the Bun config reader and the
// settings UI, so a persisted value and a UI-entered value clamp identically.

import type { SupervisionConfig } from './types';

export const CONFIG_DEFAULTS: SupervisionConfig = {
  diffStyle: 'split',
  ignoreWhitespace: true,
  lineWrap: false,
  fontSize: 13,
};

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
