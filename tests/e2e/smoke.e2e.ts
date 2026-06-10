// Smoke: web mode boots, the diff renders, and the keyboard reaches it.

import { expect, test } from '@playwright/test';
import { barCursor, cursorLine, nav, navLogs, openFixture, selectedPath } from './helpers';

test('web mode boots the real app on the basic fixture', async ({ page }) => {
  await openFixture(page);
  expect(await selectedPath(page)).toBe('src/app.ts');
  const state = await page.evaluate(() => {
    const s = window.__test?.store.getState();
    return {
      repoRoot: s?.model?.repoRoot,
      files: s?.model ? s.model.unreviewed.length + s.model.reviewed.length : 0,
      comments: s?.comments.length ?? 0,
    };
  });
  expect(state.repoRoot).toBe('fixture://basic');
  expect(state.files).toBe(6);
  expect(state.comments).toBe(3);
});

test('NAV-1 (smoke): j advances the selection one stop and logs the move', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  await nav(page, 'j', 3);
  // Fresh file, no cursor: first j lands ON the first visible stop (the
  // leading bar), then steps into the hunk's first context lines.
  const line = await cursorLine(page);
  expect(line).not.toBeNull();
  const moves = await navLogs(page, 'j');
  expect(moves.length).toBeGreaterThan(0);
});

test('NAV-3 (smoke): landing on a bar highlights it and keeps the selection', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  // Walk until the bar cursor appears (the leading bar is the first stop).
  let onBar: number | null = null;
  for (let i = 0; i < 30 && onBar === null; i++) {
    await nav(page, 'j');
    onBar = await barCursor(page);
  }
  expect(onBar).not.toBeNull();
});
