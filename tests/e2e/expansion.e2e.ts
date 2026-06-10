// EXP — expansion. See docs/specs/diff-navigation.md. The full entry-point ×
// direction × view-mode matrix lands with the regression-suite milestone;
// this file starts with the reviewed behavior changes.

import { expect, test } from '@playwright/test';
import { barCursor, cursorLine, nav, openFixture } from './helpers';

/** Walk j until the bar cursor appears; returns its expand index. */
async function walkOntoBar(page: Parameters<typeof nav>[0], maxSteps = 40): Promise<number> {
  for (let i = 0; i < maxSteps; i++) {
    await nav(page, 'j');
    const bar = await barCursor(page);
    if (bar !== null) {
      return bar;
    }
  }
  throw new Error('never reached a bar');
}

test('EXP-9 / EXP-6: expanding drops the bar cursor and j steps into the first revealed line', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-large',
  });
  // ] to the line-155 change block, then walk onto the middle bar below it.
  await nav(page, ']');
  const before = await cursorLine(page);
  expect(before).toBe(155);
  await walkOntoBar(page);
  const lineBeforeBar = await cursorLine(page);
  expect(lineBeforeBar).not.toBeNull();

  // Enter expands 100+100 of the ~437-line gap — the bar remains, smaller.
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__test?.settle());
  await page.evaluate(() => window.__test?.settle());

  // EXP-9: the bar cursor is dropped even though the bar still exists.
  expect(await barCursor(page)).toBeNull();

  // EXP-6: j continues from the selection into the first revealed line.
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe((lineBeforeBar as number) + 1);
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe((lineBeforeBar as number) + 2);
});
