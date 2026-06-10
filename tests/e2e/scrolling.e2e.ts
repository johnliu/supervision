// SCR — scrolling and visibility. See docs/specs/diff-navigation.md.

import { expect, test } from '@playwright/test';
import {
  clearNavLogs,
  clickExpandPill,
  cursorLine,
  nav,
  openFixture,
  scrollDiffBy,
  scrollerScrollTop,
} from './helpers';

test('CUR-5 / SCR-5: j steps from the cursor and returns to it after a manual scroll-away', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-large',
  });
  // Land on the first change block (line 155) and step once: cursor at 156.
  await nav(page, ']');
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe(156);

  // Make the document tall (collapsed diffs are compact): shift-click fully
  // reveals the ~437-line middle gap below the cursor. Selection survives
  // expansion (EXP-8), so the cursor stays at 156.
  await clickExpandPill(page, 1, {
    shift: true,
  });
  expect(await cursorLine(page)).toBe(156);
  const homeScrollTop = await scrollerScrollTop(page);

  // Scroll the cursor far out of view.
  await scrollDiffBy(page, 4000);
  const awayScrollTop = await scrollerScrollTop(page);
  expect(awayScrollTop).toBeGreaterThan(homeScrollTop + 3000);

  // The next j continues from the cursor (156 -> 157) and the destination row
  // is brought back into view — manual scrolling never relocates the cursor.
  await clearNavLogs(page);
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe(157);
  const backScrollTop = await scrollerScrollTop(page);
  expect(backScrollTop).toBeLessThan(awayScrollTop - 2000);
});
