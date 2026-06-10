// NAV / CUR — cursor stepping and resolution. See docs/specs/diff-navigation.md.

import { expect, test } from '@playwright/test';
import {
  barCursor,
  cursorLine,
  nav,
  openFixture,
  selectedLines,
  selectFile,
  setSelection,
  walkOntoBar,
} from './helpers';

test('NAV-1: j moves one stop forward, k one back, selecting exactly that line', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']'); // change at 41
  expect(await cursorLine(page)).toBe(41);
  await nav(page, 'j');
  const sel = await selectedLines(page);
  expect(sel).toMatchObject({
    start: 42,
    end: 42,
  });
  await nav(page, 'k');
  expect(await cursorLine(page)).toBe(41);
});

test('NAV-2: j on the last stop and k on the first stop do nothing', async ({ page }) => {
  await openFixture(page, {
    fixture: 'edge-blocks',
  });
  // Change on the last line (60) — the file's last stop is a line stop.
  await setSelection(page, {
    start: 60,
    end: 60,
    side: 'additions',
    endSide: 'additions',
  });
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe(60);
  // First stop is the line-1 change row.
  await setSelection(page, {
    start: 1,
    end: 1,
    side: 'additions',
    endSide: 'additions',
  });
  await nav(page, 'k');
  expect(await cursorLine(page)).toBe(1);
});

test('NAV-4: ] and [ jump between change-block starts, wrapping', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']');
  expect(await cursorLine(page)).toBe(41);
  await nav(page, ']');
  expect(await cursorLine(page)).toBe(75);
  await nav(page, ']');
  expect(await cursorLine(page)).toBe(140);
  await nav(page, ']'); // wraps to the first block
  expect(await cursorLine(page)).toBe(41);
  await nav(page, '['); // wraps backward to the last block
  expect(await cursorLine(page)).toBe(140);
});

test('NAV-6: navigation keys are inert while typing in the comment composer', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']');
  expect(await cursorLine(page)).toBe(41);
  // Open the composer on the selection and focus its textarea.
  await page.evaluate(() => {
    const store = window.__test?.store.getState();
    store?.commentOnRange('src/gaps-small.ts', {
      start: 41,
      end: 41,
      side: 'additions',
      endSide: 'additions',
    });
  });
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.click();
  await page.keyboard.type('jjj]');
  expect(await cursorLine(page)).toBe(41); // unchanged
  await expect(textarea).toHaveValue('jjj]');
});

test('NAV-7: keys act on the newly selected file immediately', async ({ page }) => {
  await openFixture(page); // basic, src/app.ts auto-selected
  await nav(page, ']');
  await selectFile(page, 'src/renamed-new.ts');
  await nav(page, ']');
  // The renamed file's only change is at line 25.
  expect(await cursorLine(page)).toBe(25);
});

test('CUR-1: the bar cursor outranks the line selection for stepping', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']'); // 41
  await walkOntoBar(page, 'j'); // selection rests at 45, cursor on the 46-70 bar
  expect(await cursorLine(page)).toBe(45);
  expect(await barCursor(page)).not.toBeNull();
  // j steps from the BAR (across the collapsed gap to 71), not from the
  // selection (which would re-land on the bar).
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe(71);
});
