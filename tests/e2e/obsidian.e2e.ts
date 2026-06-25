import { expect, test } from '@playwright/test';
import { openFixture, settle } from './helpers';

test.describe('OBS-E2E: Obsidian markdown preview', () => {
  test('renders callout, highlight, wikilink, and mermaid SVG', async ({ page }) => {
    await openFixture(page, {
      fixture: 'obsidian',
      file: 'docs/plan.md',
    });

    // Flip the preview toggle deterministically through the store.
    await page.evaluate(() => window.__test?.store.getState().togglePreview());
    await settle(page);

    const preview = page.getByTestId('markdown-preview');
    await expect(preview).toBeVisible();

    // Callout (renders synchronously).
    await expect(preview.locator('.obs-callout.obs-callout-warning')).toBeVisible();

    // Highlight.
    await expect(
      preview.locator('mark', {
        hasText: 'bright',
      }),
    ).toBeVisible();

    // Wikilink.
    await expect(preview.locator('a.obs-wikilink[data-wikilink="Other Note"]')).toBeVisible();

    // Mermaid: SVG appears once the async render lands.
    await expect(preview.locator('.obs-mermaid svg').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
