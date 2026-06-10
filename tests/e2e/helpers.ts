// Shared helpers for the e2e suite. The page under test is /web.html (the real
// app over the fixture backend); window.__test is installed by the web entry.
//
// Assertion strategy: store state and the '[nav]' log buffer are the primary
// signals (deterministic); DOM geometry only for visibility/scroll items.
// Playwright locators pierce the diff renderer's open shadow root natively,
// and page.keyboard/mouse are trusted driver-level input.

import type { SelectedLineRange } from '@pierre/diffs/react';
import { expect, type Page } from '@playwright/test';

export interface OpenFixtureOptions {
  fixture?: string;
  style?: 'split' | 'unified';
  ws?: boolean;
  file?: string;
}

export interface NavLogEntry {
  label: string;
  detail?: Record<string, unknown>;
  t: number;
}

/** Navigate to /web.html with the given params and wait for the model+diff. */
export async function openFixture(page: Page, opts: OpenFixtureOptions = {}): Promise<void> {
  const params = new URLSearchParams();
  if (opts.fixture) {
    params.set('fixture', opts.fixture);
  }
  if (opts.style) {
    params.set('style', opts.style);
  }
  if (opts.ws !== undefined) {
    params.set('ws', opts.ws ? '1' : '0');
  }
  if (opts.file) {
    params.set('file', opts.file);
  }
  const query = params.toString();
  await page.goto(`/web.html${query ? `?${query}` : ''}`);
  await page.waitForFunction(() => window.__test?.store.getState().model != null);
  // The diff pane mounts once a file is selected (the store auto-selects the
  // first file); wait for rendered rows so keyboard nav has a live layout.
  await expect(page.locator('[data-testid="diff-pane"]')).toBeVisible();
  await page.waitForFunction(() => {
    const pane = document.querySelector('[data-testid="diff-pane"]');
    if (!pane) {
      return false;
    }
    for (const el of pane.querySelectorAll('*')) {
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow?.querySelector('[data-line]')) {
        return true;
      }
    }
    return false;
  });
  await settle(page);
}

/** Two animation frames + a macrotask — flushes React, CodeView, and scroll. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => window.__test?.settle());
}

/** Press a navigation key (trusted input) and settle. */
export async function nav(
  page: Page,
  key: 'j' | 'k' | ']' | '[' | 'Enter' | 'Shift+J' | 'Shift+K',
  times = 1,
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await settle(page);
  }
}

export async function selectedLines(page: Page): Promise<SelectedLineRange | null> {
  return page.evaluate(() => {
    const test = window.__test;
    if (!test) {
      throw new Error('test hooks missing');
    }
    return test.store.getState().selectedLines;
  });
}

/** Shorthand: the selection's end line, or null. */
export async function cursorLine(page: Page): Promise<number | null> {
  const sel = await selectedLines(page);
  return sel ? sel.end : null;
}

export async function selectedPath(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__test?.store.getState().selectedPath ?? null);
}

/** Set the line selection through the store (for arranging test state). */
export async function setSelection(page: Page, range: SelectedLineRange): Promise<void> {
  await page.evaluate((r) => {
    window.__test?.store.getState().setSelectedLines(r);
  }, range);
  await settle(page);
}

export async function selectFile(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.__test?.store.getState().select(p);
  }, path);
  await settle(page);
  await settle(page);
}

export async function navLogs(page: Page, label?: string): Promise<NavLogEntry[]> {
  const logs = (await page.evaluate(() => window.__test?.navLogs() ?? [])) as NavLogEntry[];
  return label ? logs.filter((entry) => entry.label.startsWith(label)) : logs;
}

export async function clearNavLogs(page: Page): Promise<void> {
  await page.evaluate(() => window.__test?.clearNavLogs());
}

/** The expand-index of the bar carrying the keyboard cursor, or null. */
export async function barCursor(page: Page): Promise<number | null> {
  const attr = await page
    .locator('[data-separator][data-nav-cursor]')
    .first()
    .getAttribute('data-expand-index')
    .catch(() => null);
  return attr == null ? null : Number(attr);
}

export interface SeparatorInfo {
  expandIndex: number;
  lines: number | null;
}

/** Rendered separators (deduped by expand-index; split view draws two). */
export async function separators(page: Page): Promise<SeparatorInfo[]> {
  return page.evaluate(() => {
    const seen = new Map<
      number,
      {
        expandIndex: number;
        lines: number | null;
      }
    >();
    const pane = document.querySelector('[data-testid="diff-pane"]');
    if (!pane) {
      return [];
    }
    for (const el of pane.querySelectorAll('*')) {
      const shadow = (el as HTMLElement).shadowRoot;
      if (!shadow) {
        continue;
      }
      for (const sep of shadow.querySelectorAll('[data-separator][data-expand-index]')) {
        const idx = Number(sep.getAttribute('data-expand-index'));
        if (seen.has(idx)) {
          continue;
        }
        const text = sep.querySelector('[data-unmodified-lines]')?.textContent ?? '';
        const match = /(\d+) unmodified/.exec(text);
        seen.set(idx, {
          expandIndex: idx,
          lines: match ? Number(match[1]) : null,
        });
      }
    }
    return [
      ...seen.values(),
    ].sort((a, b) => a.expandIndex - b.expandIndex);
  });
}

/** Click a bar's "N unmodified lines" pill (the lib's expand trigger). */
export async function clickExpandPill(
  page: Page,
  expandIndex: number,
  opts: {
    shift?: boolean;
  } = {},
): Promise<void> {
  await page
    .locator(`[data-separator][data-expand-index="${expandIndex}"] [data-unmodified-lines]`)
    .first()
    .click({
      modifiers: opts.shift
        ? [
            'Shift',
          ]
        : [],
    });
  await settle(page);
  await settle(page);
}

/** The diff scroller's scrollTop (DOM == logical at fixture sizes). */
export async function scrollerScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="diff-scroller"]');
    return scroller ? Math.round(scroller.scrollTop) : -1;
  });
}

/** Scroll the diff pane by a delta, dispatching a real scroll event. */
export async function scrollDiffBy(page: Page, deltaY: number): Promise<void> {
  await page.evaluate((dy) => {
    const scroller = document.querySelector('[data-testid="diff-scroller"]');
    if (scroller) {
      scroller.scrollTop += dy;
    }
  }, deltaY);
  await settle(page);
  await settle(page);
}

/** Bounding box of a rendered line's row cell, or null if unrendered. */
export async function lineBox(
  page: Page,
  line: number,
  side: 'additions' | 'deletions' = 'additions',
): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  const scope = side === 'deletions' ? '[data-deletions]' : '[data-additions]';
  const cell = page.locator(`${scope} [data-line="${line}"]`).first();
  if ((await cell.count()) === 0) {
    // Unified view has no per-side columns; fall back to any matching cell.
    const fallback = page.locator(`[data-line="${line}"]`).first();
    return (await fallback.count()) > 0 ? fallback.boundingBox() : null;
  }
  return cell.boundingBox();
}

export { expect };
