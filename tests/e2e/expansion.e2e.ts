// EXP — expansion. See docs/specs/diff-navigation.md.
//
// The matrix below encodes the June 2026 regression history: every expansion
// entry point × approach direction × view mode must leave the nav model and
// the renderer agreeing, so stepping continues through the revealed lines.
//
// gaps-large geometry (4-line parser context): hunks at 151-159 / 596-604 /
// 901-909; the middle bar (expand index 1) hides lines 160-595. A 'both'
// expansion of 100 reveals 160-259 and 496-595.

import { expect, test } from '@playwright/test';
import {
  barCursor,
  clearNavLogs,
  clickExpandButton,
  clickExpandPill,
  cursorLine,
  nav,
  navLogs,
  openFixture,
  selectedLines,
  separators,
  setSelection,
  walkOntoBar,
} from './helpers';

type Approach = 'above' | 'below';
type Entry = 'enter' | 'pill' | 'shift-pill';

/** Position the cursor adjacent to the middle bar (expand index 1). */
async function approachBar(page: Parameters<typeof nav>[0], approach: Approach): Promise<number> {
  if (approach === 'above') {
    await nav(page, ']'); // line-155 block
    await walkOntoBar(page, 'j');
  } else {
    await nav(page, ']');
    await nav(page, ']'); // line-600 block
    await walkOntoBar(page, 'k');
  }
  const line = await cursorLine(page);
  expect(line).not.toBeNull();
  return line as number;
}

async function expandVia(page: Parameters<typeof nav>[0], entry: Entry): Promise<void> {
  if (entry === 'enter') {
    await nav(page, 'Enter');
  } else {
    await clickExpandPill(page, 1, {
      shift: entry === 'shift-pill',
    });
  }
}

for (const style of [
  'split',
  'unified',
] as const) {
  for (const approach of [
    'above',
    'below',
  ] as const) {
    for (const entry of [
      'enter',
      'pill',
      'shift-pill',
    ] as const) {
      test(`EXP-6 / EXP-7 / EXP-8 / EXP-9 (${style}, from ${approach}, via ${entry}): stepping continues into the revealed lines`, async ({
        page,
      }) => {
        await openFixture(page, {
          fixture: 'gaps-large',
          style,
        });
        const lineBeforeBar = await approachBar(page, approach);
        // From above the selection rests on 159; from below on 596.
        expect(lineBeforeBar).toBe(approach === 'above' ? 159 : 596);

        await expandVia(page, entry);

        // EXP-9: the bar cursor is dropped by every expansion entry point.
        expect(await barCursor(page)).toBeNull();
        // EXP-8: the line selection survives expansion.
        const sel = await selectedLines(page);
        expect(sel?.end).toBe(lineBeforeBar);

        // EXP-6/7: step toward the bar — into the revealed lines, no leap.
        const step = approach === 'above' ? 'j' : 'k';
        const expectedFirst = approach === 'above' ? 160 : 595;
        await nav(page, step);
        expect(await cursorLine(page)).toBe(expectedFirst);
        await nav(page, step);
        expect(await cursorLine(page)).toBe(approach === 'above' ? 161 : 594);
      });
    }
  }
}

test('EXP-7 (directional buttons): up reveals from the top, down from the bottom', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-large',
  });
  // From above + "expand up" (chunked bars have separate buttons):
  await nav(page, ']');
  await walkOntoBar(page, 'j');
  await clickExpandButton(page, 1, 'up');
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe(160);

  // The remaining bar now hides 260-595. From below + "expand down":
  await nav(page, ']'); // 600 block
  await walkOntoBar(page, 'k');
  await clickExpandButton(page, 1, 'down');
  await nav(page, 'k');
  expect(await cursorLine(page)).toBe(595);
});

test('EXP-3: one Enter advances the bar by exactly one 100-line chunk per end', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-large',
  });
  await nav(page, ']');
  await walkOntoBar(page, 'j');
  const before = (await separators(page)).find((s) => s.expandIndex === 1);
  expect(before?.lines).toBe(436);
  await nav(page, 'Enter');
  // The shrunken bar moved ~2000px down (100 lines revealed above it) and is
  // virtualized out; step to its new edge to bring it into the render window.
  await setSelection(page, {
    start: 258,
    end: 258,
    side: 'additions',
    endSide: 'additions',
  });
  await nav(page, 'j'); // 259 — the last revealed line of the top chunk
  expect(await cursorLine(page)).toBe(259);
  await nav(page, 'j'); // onto the remaining bar
  expect(await barCursor(page)).toBe(1);
  await expect.poll(async () => (await separators(page)).find((s) => s.expandIndex === 1)?.lines ?? null).toBe(236); // 436 - 100 (top) - 100 (bottom)
});

test('EXP-5: shift-click reveals the entire range at once', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-large',
  });
  await nav(page, ']');
  await walkOntoBar(page, 'j');
  await clickExpandPill(page, 1, {
    shift: true,
  });
  await expect.poll(async () => (await separators(page)).some((s) => s.expandIndex === 1)).toBe(false);
  // The whole hidden range is now steppable.
  await nav(page, 'j');
  expect(await cursorLine(page)).toBe(160);
});

test('EXP-10: a fully revealed bar is never a landing target', async ({ page }) => {
  await openFixture(page, {
    fixture: 'gaps-small',
  });
  // Walk onto the middle bar (hides 46-70, 25 lines) and fully expand it.
  await nav(page, ']');
  await walkOntoBar(page, 'j');
  await nav(page, 'Enter');
  // Step across the formerly hidden region: the bar cursor never reappears.
  await clearNavLogs(page);
  for (let i = 0; i < 8; i++) {
    await nav(page, 'j');
    expect(await barCursor(page)).toBeNull();
  }
  const lines = await navLogs(page, 'j');
  expect(lines.length).toBe(8);
});
