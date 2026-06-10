// FILE — file/view-mode state. See docs/specs/diff-navigation.md.

import { expect, test } from '@playwright/test';
import { clickExpandPill, openFixture, selectFile, separators, settle } from './helpers';

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
