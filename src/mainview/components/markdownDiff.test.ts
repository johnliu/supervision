// Block-level rendered-markdown diff: marker placement and grouping. The
// output is unsanitized HTML (the component sanitizes), so assertions match
// on the marker wrappers and the rendered block tags inside them.

import { describe, expect, test } from 'bun:test';
import { renderMarkdownDiff } from './markdownDiff';

const ADDED = /<div class="md-block-added">/g;
const REMOVED = /<div class="md-block-removed">/g;

function counts(html: string): {
  added: number;
  removed: number;
} {
  return {
    added: (html.match(ADDED) ?? []).length,
    removed: (html.match(REMOVED) ?? []).length,
  };
}

describe('renderMarkdownDiff', () => {
  test('MDD-1: identical documents render with no change markers', () => {
    const doc = '# Title\n\nA paragraph.\n\n- one\n- two\n';
    const html = renderMarkdownDiff(doc, doc);
    expect(counts(html)).toEqual({
      added: 0,
      removed: 0,
    });
    expect(html).toContain('<h1>Title</h1>');
  });

  test('MDD-2: an inserted paragraph is marked added, neighbors stay plain', () => {
    const oldDoc = '# Title\n\nFirst.\n\nLast.\n';
    const newDoc = '# Title\n\nFirst.\n\nInserted paragraph.\n\nLast.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 0,
    });
    expect(html).toContain('<div class="md-block-added"><p>Inserted paragraph.</p>\n</div>');
    expect(html).toContain('<h1>Title</h1>');
  });

  test('MDD-3: a deleted block is marked removed', () => {
    const oldDoc = 'First.\n\nDoomed.\n\nLast.\n';
    const newDoc = 'First.\n\nLast.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 0,
      removed: 1,
    });
    expect(html).toContain('<div class="md-block-removed"><p>Doomed.</p>\n</div>');
  });

  test('MDD-4: an edited paragraph shows old (removed) above new (added)', () => {
    const html = renderMarkdownDiff('Hello world.\n', 'Hello there.\n');
    expect(counts(html)).toEqual({
      added: 1,
      removed: 1,
    });
    expect(html.indexOf('md-block-removed')).toBeLessThan(html.indexOf('md-block-added'));
  });

  test('MDD-5: consecutive added blocks group into ONE marker box', () => {
    const oldDoc = 'Intro.\n';
    const newDoc = 'Intro.\n\n## New section\n\nBody one.\n\nBody two.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 0,
    });
    const box = html.slice(html.indexOf('md-block-added'));
    expect(box).toContain('New section');
    expect(box).toContain('Body two.');
  });

  test('MDD-6: blank-line-only changes produce no markers', () => {
    const html = renderMarkdownDiff('First.\n\nLast.\n', 'First.\n\n\n\nLast.\n');
    expect(counts(html)).toEqual({
      added: 0,
      removed: 0,
    });
  });

  test('MDD-7: an empty old side renders everything as one added run', () => {
    // The component skips markers for brand-new files; the function itself
    // stays honest when called directly.
    const html = renderMarkdownDiff('', '# Doc\n\nBody.\n');
    expect(counts(html)).toEqual({
      added: 1,
      removed: 0,
    });
  });

  test('MDD-8: an edited bullet marks only that item, list renders once', () => {
    const oldDoc = '- alpha\n- beta two\n- gamma\n';
    const newDoc = '- alpha\n- beta three\n- gamma\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    // No whole-block boxes — the change surface is the item, not the list.
    expect(counts(html)).toEqual({
      added: 0,
      removed: 0,
    });
    expect((html.match(/<ul>/g) ?? []).length).toBe(1);
    expect(html).toContain('<li class="md-li-removed">beta two</li>');
    expect(html).toContain('<li class="md-li-added">beta three</li>');
    expect(html).toContain('<li>alpha</li>');
    expect(html).not.toMatch(/md-li-(added|removed)">alpha/);
    // Old reads above new.
    expect(html.indexOf('md-li-removed')).toBeLessThan(html.indexOf('md-li-added'));
  });

  test('MDD-9: an appended bullet marks only the new item', () => {
    const html = renderMarkdownDiff('- one\n- two\n', '- one\n- two\n- three\n');
    expect(counts(html)).toEqual({
      added: 0,
      removed: 0,
    });
    expect(html).toContain('<li class="md-li-added">three</li>');
    expect((html.match(/md-li-/g) ?? []).length).toBe(1);
  });

  test('MDD-10: an edited table row marks only that row, header renders once', () => {
    const oldDoc = '| ID | Note |\n| -- | -- |\n| A | first |\n| B | second |\n';
    const newDoc = '| ID | Note |\n| -- | -- |\n| A | first |\n| B | rewritten |\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 0,
      removed: 0,
    });
    expect((html.match(/<table>/g) ?? []).length).toBe(1);
    expect((html.match(/<thead>/g) ?? []).length).toBe(1);
    expect(html).toContain('<tr class="md-row-removed">');
    expect(html).toContain('<tr class="md-row-added">');
    // The unchanged row carries no mark.
    expect(html).toMatch(/<tr>\n<td>A<\/td>/);
  });

  test('MDD-11: a changed table header falls back to block boxes', () => {
    const oldDoc = '| ID | Note |\n| -- | -- |\n| A | first |\n';
    const newDoc = '| ID | Comment |\n| -- | -- |\n| A | first |\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 1,
    });
    expect(html).not.toContain('md-row-');
  });

  test('MDD-12: an ul↔ol rewrite falls back to block boxes', () => {
    const html = renderMarkdownDiff('- one\n- two\n', '1. one\n2. two\n');
    expect(counts(html)).toEqual({
      added: 1,
      removed: 1,
    });
    expect(html).not.toContain('md-li-');
  });

  test('MDD-13: task-list checkboxes survive the per-item render', () => {
    const oldDoc = '- [ ] ship it\n- [ ] test it\n';
    const newDoc = '- [x] ship it\n- [ ] test it\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(html).toContain('md-li-removed');
    expect(html).toContain('md-li-added');
    expect(html).toContain('checked');
    expect((html.match(/<ul>/g) ?? []).length).toBe(1);
  });

  test('MDD-14: an edit deep in a nested list marks only the innermost bullets', () => {
    const oldDoc = '- alpha\n- parent intro\n  - sub one\n  - sub two\n- omega\n';
    const newDoc = '- alpha\n- parent intro\n  - sub one\n  - sub three\n- omega\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    // No block boxes, and exactly one removed/added pair — the sub-bullet.
    expect(counts(html)).toEqual({
      added: 0,
      removed: 0,
    });
    expect(html).toContain('<li class="md-li-removed">sub two</li>');
    expect(html).toContain('<li class="md-li-added">sub three</li>');
    // Outer structure renders once and stays unmarked: siblings, the parent
    // item's own text, and the unchanged sub-bullet.
    expect((html.match(/md-li-/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/md-li-(added|removed)"[^>]*>(alpha|omega)/);
    expect(html.indexOf('parent intro')).toBe(html.lastIndexOf('parent intro'));
    expect(html.indexOf('sub one')).toBe(html.lastIndexOf('sub one'));
  });

  test('MDD-15: a list edit plus a new sibling block still descends', () => {
    const oldDoc = '- one\n- two\n';
    const newDoc = '- one\n- two edited\n\nNew trailing paragraph.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    // The list descends to item marks; the extra paragraph boxes as added.
    expect(counts(html)).toEqual({
      added: 1,
      removed: 0,
    });
    expect((html.match(/<ul>/g) ?? []).length).toBe(1);
    expect(html).toContain('<li class="md-li-removed">two</li>');
    expect(html).toContain('<li class="md-li-added">two edited</li>');
    expect(html).toContain('<div class="md-block-added"><p>New trailing paragraph.</p>\n</div>');
  });

  test('MDD-16: an added callout boxes as md-block-added once', () => {
    const oldDoc = 'Intro.\n';
    const newDoc = "Intro.\n\n> [!warning] Heads up\n> Don't do that.\n";
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 0,
    });
    expect(html).toContain('obs-callout-warning');
  });

  test('MDD-17: an edited callout body shows old above new', () => {
    const oldDoc = '> [!note]\n> Original.\n';
    const newDoc = '> [!note]\n> Rewritten.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 1,
    });
    expect(html.indexOf('Original')).toBeLessThan(html.indexOf('Rewritten'));
  });

  test('MDD-18: a highlight added in a paragraph marks the whole paragraph', () => {
    const oldDoc = 'Hello world.\n';
    const newDoc = 'Hello ==bright== world.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 1,
    });
    expect(html).toContain('<mark>bright</mark>');
  });

  test('MDD-19: a swapped image embed boxes as a paragraph change', () => {
    const oldDoc = '![[before.png]]\n';
    const newDoc = '![[after.png]]\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 1,
    });
    expect(html).toContain('data-embed="before.png"');
    expect(html).toContain('data-embed="after.png"');
  });

  test('MDD-20: an added mermaid diagram boxes as md-block-added with the marker', () => {
    const oldDoc = 'Plain prose.\n';
    const newDoc = 'Plain prose.\n\n```mermaid\ngraph LR\nA --> B\n```\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 0,
    });
    expect(html).toContain('class="obs-mermaid"');
  });

  test('MDD-21: an edited mermaid diagram shows both markers (old above new)', () => {
    const oldDoc = '```mermaid\ngraph LR\nA --> B\n```\n';
    const newDoc = '```mermaid\ngraph LR\nA --> C\n```\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({
      added: 1,
      removed: 1,
    });
    // Both versions retain their marker div so the React effect can render
    // each independently.
    expect((html.match(/class="obs-mermaid"/g) ?? []).length).toBe(2);
  });
});
