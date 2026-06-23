import { describe, expect, test } from 'bun:test';
import { sanitizeWindowState } from './windowState';

describe('sanitizeWindowState', () => {
  test('WIN-1: passes through a valid frame', () => {
    expect(
      sanitizeWindowState({
        x: 120,
        y: 80,
        width: 1400,
        height: 900,
      }),
    ).toEqual({
      x: 120,
      y: 80,
      width: 1400,
      height: 900,
    });
  });

  test('WIN-2: keeps negative coordinates (a second display to the left)', () => {
    expect(
      sanitizeWindowState({
        x: -1280,
        y: -200,
        width: 800,
        height: 600,
      }),
    ).toEqual({
      x: -1280,
      y: -200,
      width: 800,
      height: 600,
    });
  });

  test('WIN-3: floors a too-small size but leaves the position', () => {
    const result = sanitizeWindowState({
      x: 10,
      y: 10,
      width: 50,
      height: 20,
    });
    expect(result).toEqual({
      x: 10,
      y: 10,
      width: 600,
      height: 400,
    });
  });

  test('WIN-4: rejects malformed or partial state', () => {
    expect(sanitizeWindowState(null)).toBeNull();
    expect(sanitizeWindowState('1400x900')).toBeNull();
    expect(
      sanitizeWindowState({
        x: 0,
        y: 0,
        width: Number.NaN,
        height: 900,
      }),
    ).toBeNull();
    expect(
      sanitizeWindowState({
        x: 0,
        y: 0,
        width: 1400,
      }),
    ).toBeNull();
  });
});
