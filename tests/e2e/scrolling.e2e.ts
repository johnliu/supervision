// SCR — scrolling and visibility. See docs/specs/diff-navigation.md.

import { expect, test } from '@playwright/test';
import {
  clearNavLogs,
  clickExpandPill,
  cursorLine,
  lineBox,
  nav,
  navLogs,
  openFixture,
  scrollDiffBy,
  scrollerScrollTop,
  selectFile,
  settle,
  walkOntoBar,
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
  // reveals the ~436-line middle gap below the cursor. Selection survives
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

test('SCR-1 / SCR-2: one scroll request per keypress; no scroll while the target is visible', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']');
  const before = await scrollerScrollTop(page);
  await clearNavLogs(page);
  await nav(page, 'j', 3); // interior steps, all within the viewport
  const scrolls = await navLogs(page, 'scrollTo');
  expect(scrolls.length).toBe(3); // SCR-1: exactly one request per keypress
  expect(await scrollerScrollTop(page)).toBe(before); // SCR-2: none moved the view
});

test('SCR-3: ] to an off-screen block lands the cursor inside the viewport', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-large',
  });
  // Expand everything between the blocks so 600 is genuinely far away.
  await nav(page, ']');
  await clickExpandPill(page, 1, {
    shift: true,
  });
  await nav(page, ']'); // line-600 block, ~9000px down
  expect(await cursorLine(page)).toBe(600);
  await expect
    .poll(async () => {
      const box = await lineBox(page, 600);
      if (!box) {
        return 'unrendered';
      }
      const scroller = await page.locator('[data-testid="diff-scroller"]').boundingBox();
      if (!scroller) {
        return 'no scroller';
      }
      const inside = box.y >= scroller.y - 1 && box.y + box.height <= scroller.y + scroller.height + 1;
      return inside ? 'visible' : 'outside';
    })
    .toBe('visible');
});

test('SCR-4: expanding keeps the rows above the bar stationary and issues no cursor scroll', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-large',
  });
  await nav(page, ']');
  await walkOntoBar(page, 'j'); // selection at 159, bar below in view
  const rowBefore = await lineBox(page, 159);
  const scrollBefore = await scrollerScrollTop(page);
  await clearNavLogs(page);
  await nav(page, 'Enter');
  await settle(page);
  // No cursor scroll was issued by the expansion itself.
  expect((await navLogs(page, 'scrollTo')).length).toBe(0);
  // The viewport did not move, and the row above the bar kept its position.
  expect(await scrollerScrollTop(page)).toBe(scrollBefore);
  const rowAfter = await lineBox(page, 159);
  expect(rowAfter?.y).toBe(rowBefore?.y);
});

test('SCR-6: every file opens scrolled to the top', async ({ page }) => {
  await openFixture(page); // basic
  // Scroll down in app.ts, then switch files.
  await scrollDiffBy(page, 800);
  expect(await scrollerScrollTop(page)).toBeGreaterThan(0);
  await selectFile(page, 'src/legacy.ts');
  await expect.poll(() => scrollerScrollTop(page)).toBe(0);
});

test('SCR-7: keyboard navigation never changes horizontal scroll', async ({ page }) => {
  test.slow(); // 3000-line fixture: cold tokenization is heavy under parallel webkit workers
  await openFixture(page, {
    fixture: 'long-file',
  });
  await nav(page, ']');
  // Find the horizontally scrollable code container and scroll it right.
  const scrolledTo = await page
    .locator('pre[data-diff]')
    .first()
    .evaluate((pre) => {
      const candidates = [
        pre,
        ...Array.from(pre.querySelectorAll('[data-additions], [data-deletions], [data-code]')),
      ] as HTMLElement[];
      for (const el of candidates) {
        if (el.scrollWidth > el.clientWidth + 50) {
          el.scrollLeft = 150;
          return el.scrollLeft;
        }
      }
      return -1;
    });
  expect(scrolledTo).toBeGreaterThan(0);
  await nav(page, 'j', 4);
  const after = await page
    .locator('pre[data-diff]')
    .first()
    .evaluate((pre) => {
      const candidates = [
        pre,
        ...Array.from(pre.querySelectorAll('[data-additions], [data-deletions], [data-code]')),
      ] as HTMLElement[];
      for (const el of candidates) {
        if (el.scrollLeft > 0) {
          return el.scrollLeft;
        }
      }
      return 0;
    });
  expect(after).toBe(scrolledTo);
});
