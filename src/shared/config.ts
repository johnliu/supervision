// Config defaults + validation shared by the Bun config reader and the
// settings UI, so a persisted value and a UI-entered value clamp identically.

import type { DiffThemeId, EditorId, PaletteId, SupervisionConfig, ThemePreference } from './types';

export const CONFIG_DEFAULTS: SupervisionConfig = {
  diffStyle: 'split',
  ignoreWhitespace: true,
  lineWrap: false,
  fontSize: 13,
  editor: 'open',
  theme: 'dark',
  palette: 'olive',
  diffTheme: 'pierre',
  onboarded: false,
};

/** Base-color families the settings dialog offers. `swatch` is the picker
 * chip color (the family's mid gray); the real values live in index.css under
 * `[data-palette]`. */
export const PALETTES: Array<{
  id: PaletteId;
  label: string;
  swatch: string;
}> = [
  {
    id: 'olive',
    label: 'Olive',
    swatch: 'oklch(0.58 0.031 107)',
  },
  {
    id: 'stone',
    label: 'Stone',
    swatch: 'oklch(0.58 0.014 56)',
  },
  {
    id: 'zinc',
    label: 'Zinc',
    swatch: 'oklch(0.58 0.016 286)',
  },
  {
    id: 'gray',
    label: 'Gray',
    swatch: 'oklch(0.58 0.027 262)',
  },
  {
    id: 'slate',
    label: 'Slate',
    swatch: 'oklch(0.58 0.046 257)',
  },
  {
    id: 'neutral',
    label: 'Neutral',
    swatch: 'oklch(0.58 0 0)',
  },
];

/** Coerce a persisted palette to a known one. */
export function clampPalette(value: unknown): PaletteId {
  return PALETTES.some((palette) => palette.id === value) ? (value as PaletteId) : CONFIG_DEFAULTS.palette;
}

/** Diff syntax themes the settings dialog offers: a shiki (or pierre) theme
 * name per palette; the active app theme picks the side. */
export const DIFF_THEMES: Array<{
  id: DiffThemeId;
  label: string;
  themes: {
    dark: string;
    light: string;
  };
}> = [
  {
    id: 'pierre',
    label: 'Pierre',
    themes: {
      dark: 'pierre-dark',
      light: 'pierre-light',
    },
  },
  {
    id: 'pierre-soft',
    label: 'Pierre Soft',
    themes: {
      dark: 'pierre-dark-soft',
      light: 'pierre-light-soft',
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    themes: {
      dark: 'github-dark',
      light: 'github-light',
    },
  },
  {
    id: 'one',
    label: 'One',
    themes: {
      dark: 'one-dark-pro',
      light: 'one-light',
    },
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    themes: {
      dark: 'catppuccin-mocha',
      light: 'catppuccin-latte',
    },
  },
  {
    id: 'vitesse',
    label: 'Vitesse',
    themes: {
      dark: 'vitesse-dark',
      light: 'vitesse-light',
    },
  },
  {
    id: 'solarized',
    label: 'Solarized',
    themes: {
      dark: 'solarized-dark',
      light: 'solarized-light',
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    themes: {
      dark: 'gruvbox-dark-medium',
      light: 'gruvbox-light-medium',
    },
  },
  {
    id: 'everforest',
    label: 'Everforest',
    themes: {
      dark: 'everforest-dark',
      light: 'everforest-light',
    },
  },
];

/** Coerce a persisted diff theme to a known one. */
export function clampDiffTheme(value: unknown): DiffThemeId {
  return DIFF_THEMES.some((theme) => theme.id === value) ? (value as DiffThemeId) : CONFIG_DEFAULTS.diffTheme;
}

/** Theme choices the settings dialog offers, in display order. */
export const THEMES: Array<{
  id: ThemePreference;
  label: string;
}> = [
  {
    id: 'system',
    label: 'System',
  },
  {
    id: 'light',
    label: 'Light',
  },
  {
    id: 'dark',
    label: 'Dark',
  },
];

/** Coerce a persisted theme to a known one. */
export function clampTheme(value: unknown): ThemePreference {
  return THEMES.some((theme) => theme.id === value) ? (value as ThemePreference) : CONFIG_DEFAULTS.theme;
}

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
