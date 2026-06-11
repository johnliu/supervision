import { describe, expect, test } from 'bun:test';
import { resolveEditorCommand } from './editor';

const FILE = '/repo/src/app.ts';

describe('resolveEditorCommand', () => {
  test('EDT-1: system default uses the macOS opener', () => {
    expect(resolveEditorCommand('open', FILE, 12, () => null)).toEqual([
      'open',
      FILE,
    ]);
  });

  test('EDT-2: VS Code family targets the line via --goto', () => {
    expect(resolveEditorCommand('cursor', FILE, 12, () => '/usr/local/bin/cursor')).toEqual([
      '/usr/local/bin/cursor',
      '--goto',
      `${FILE}:12`,
    ]);
    expect(resolveEditorCommand('code', FILE, undefined, () => '/opt/homebrew/bin/code')).toEqual([
      '/opt/homebrew/bin/code',
      '--goto',
      FILE,
    ]);
  });

  test('EDT-3: zed/subl take file:line directly', () => {
    expect(resolveEditorCommand('zed', FILE, 7, () => '/usr/local/bin/zed')).toEqual([
      '/usr/local/bin/zed',
      `${FILE}:7`,
    ]);
  });

  test('EDT-4: missing CLI shim falls back to open -a <App>', () => {
    expect(resolveEditorCommand('cursor', FILE, 12, () => null)).toEqual([
      'open',
      '-a',
      'Cursor',
      FILE,
    ]);
  });
});
