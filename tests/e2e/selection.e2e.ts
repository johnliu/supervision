// SEL — selection. See docs/specs/diff-navigation.md.

import { expect, test } from '@playwright/test';
import { barCursor, lineBox, nav, openFixture, selectedLines, selectFile, settle, walkOntoBar } from './helpers';

async function clickLine(
  page: Parameters<typeof nav>[0],
  line: number,
  opts: {
    shift?: boolean;
  } = {},
): Promise<void> {
  await page
    .locator(`[data-additions] [data-line="${line}"]`)
    .first()
    .click({
      modifiers: opts.shift
        ? [
            'Shift',
          ]
        : [],
    });
  await settle(page);
}

test('SEL-1: clicking a line selects exactly that line and anchors there', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await clickLine(page, 42);
  expect(await selectedLines(page)).toMatchObject({
    start: 42,
    end: 42,
    side: 'additions',
  });
});

test('SEL-2: shift-click extends from the anchor', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await clickLine(page, 40);
  await clickLine(page, 44, {
    shift: true,
  });
  expect(await selectedLines(page)).toMatchObject({
    start: 40,
    end: 44,
  });
});

test('SEL-3: dragging across the code area selects the range', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  const from = await lineBox(page, 40);
  const to = await lineBox(page, 43);
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  if (!from || !to) {
    return;
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await settle(page);
  expect(await selectedLines(page)).toMatchObject({
    start: 40,
    end: 43,
  });
});

test('SEL-4 / SEL-5: Shift+J/K moves the end (anchor fixed, bars skipped); plain j collapses', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']'); // 41
  await nav(page, 'Shift+J', 2);
  expect(await selectedLines(page)).toMatchObject({
    start: 41,
    end: 43,
  });
  await nav(page, 'Shift+K');
  expect(await selectedLines(page)).toMatchObject({
    start: 41,
    end: 42,
  });
  // SEL-5: plain j collapses to the stop adjacent to the end.
  await nav(page, 'j');
  expect(await selectedLines(page)).toMatchObject({
    start: 43,
    end: 43,
  });
});

test('SEL-4: Shift+J from the last context line before a bar skips over it', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']'); // 41
  await nav(page, 'j', 4); // 45, last line before the 46-70 bar
  expect((await selectedLines(page))?.end).toBe(45);
  await nav(page, 'Shift+J');
  // The end skips the bar to the next line stop (71).
  expect(await selectedLines(page)).toMatchObject({
    start: 45,
    end: 71,
  });
});

test('SEL-6: Escape clears the selection and closes the composer', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']');
  await page.evaluate(() => {
    window.__test?.store.getState().commentOnRange('src/gaps-small.ts', {
      start: 41,
      end: 41,
      side: 'additions',
      endSide: 'additions',
    });
  });
  await expect(page.locator('textarea').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await settle(page);
  expect(await selectedLines(page)).toBeNull();
  expect(await page.evaluate(() => window.__test?.store.getState().draft)).toBeNull();
});

test('SEL-7: making a line selection clears the bar-cursor highlight', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, ']');
  await walkOntoBar(page, 'j');
  expect(await barCursor(page)).not.toBeNull();
  await clickLine(page, 42);
  expect(await barCursor(page)).toBeNull();
});

test('SEL-8 / FILE-1: switching files clears selection, draft, and bar cursor', async ({ page }) => {
  await openFixture(page); // basic
  await nav(page, ']');
  expect(await selectedLines(page)).not.toBeNull();
  await selectFile(page, 'src/new-feature.ts');
  expect(await selectedLines(page)).toBeNull();
  expect(await barCursor(page)).toBeNull();
});
