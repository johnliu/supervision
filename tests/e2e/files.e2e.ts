// FILE — file/view-mode state. See docs/specs/diff-navigation.md.

import { expect, test } from '@playwright/test';
import {
  clickExpandPill,
  cursorLine,
  nav,
  openFixture,
  scrollerScrollTop,
  selectedLines,
  selectFile,
  separators,
  settle,
} from './helpers';

test('EXP-11: expansion state persists across file switches (renderer included)', async ({ page }) => {
  await openFixture(page);
  // app.ts: bars at expand-index 0 (leading), 1 and 2 (middle ~81 lines), 3
  // (trailing). Click-expand bar 1: 81 < 200 revealed -> fully gone.
  const before = await separators(page);
  expect(before.map((s) => s.expandIndex)).toContain(1);
  await clickExpandPill(page, 1);
  const after = await separators(page);
  expect(after.map((s) => s.expandIndex)).not.toContain(1);

  // Switch away and back: the expansion must be restored — in the nav model
  // AND in the freshly remounted renderer (separators read the rendered DOM).
  // Poll: the replay into the fresh renderer takes a few frames.
  await selectFile(page, 'src/new-feature.ts');
  await selectFile(page, 'src/app.ts');
  await settle(page);
  await expect
    .poll(async () => (await separators(page)).map((s) => s.expandIndex), {
      timeout: 5000,
    })
    .not.toContain(1);
  expect((await separators(page)).map((s) => s.expandIndex)).toContain(0);
});

test('FILE-2: toggling split/unified preserves the selection and the cursor line', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
    style: 'split',
  });
  await nav(page, ']');
  await nav(page, 'j'); // 42
  expect(await cursorLine(page)).toBe(42);
  await page.evaluate(() => {
    window.__test?.store.getState().setDiffStyle('unified');
  });
  await settle(page);
  await settle(page);
  expect(await selectedLines(page)).toMatchObject({
    end: 42,
  });
  // The cursor resolves to the same file line in the unified stop list.
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe(43);
});

test('FILE-3: the Unstaged/Staged toggle swaps entries with a fresh view', async ({ page }) => {
  await openFixture(page, {
    fixture: 'staged-both',
  });
  // Unstaged side: working edit at line 10.
  await expect(
    page.locator('[data-additions] [data-line="10"][data-line-type="change-addition"]').first(),
  ).toBeVisible();
  await page
    .locator('[data-testid="diff-pane"]')
    .getByText('Staged', {
      exact: true,
    })
    .click();
  await settle(page);
  await settle(page);
  // Staged side: approved edit at line 30; the view remounted at the top.
  await expect(
    page.locator('[data-additions] [data-line="30"][data-line-type="change-addition"]').first(),
  ).toBeVisible();
  expect(await scrollerScrollTop(page)).toBe(0);
});
