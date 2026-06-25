import { describe, expect, test } from 'bun:test';
import { parseObsidian } from './obsidianMarkdown';

describe('parseObsidian', () => {
  test('OBS-1: leading YAML frontmatter is stripped from rendered output', () => {
    const source = '---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n';
    const html = parseObsidian(source);
    expect(html).not.toContain('title:');
    expect(html).not.toContain('tags:');
    expect(html).toContain('<h1>Body</h1>');
  });

  test('OBS-1: mid-document --- blocks are left as horizontal rules', () => {
    const source = 'Intro.\n\n---\n\nMore.\n';
    const html = parseObsidian(source);
    expect(html).toContain('<hr>');
    expect(html).toContain('More.');
  });

  test('OBS-2: inline %%hidden%% comments are stripped', () => {
    const html = parseObsidian('Before %%secret%% after.\n');
    expect(html).toContain('Before  after.');
    expect(html).not.toContain('secret');
  });

  test('OBS-3: block %%...%% comments spanning lines are stripped', () => {
    const source = 'Open.\n\n%%\nhidden line 1\nhidden line 2\n%%\n\nClose.\n';
    const html = parseObsidian(source);
    expect(html).toContain('Open.');
    expect(html).toContain('Close.');
    expect(html).not.toContain('hidden line');
  });

  test('OBS-3: %% inside a fenced code block is preserved', () => {
    const source = '```\n%%not a comment%%\n```\n';
    const html = parseObsidian(source);
    expect(html).toContain('%%not a comment%%');
  });

  test('OBS-4: ==text== renders as <mark>text</mark>', () => {
    const html = parseObsidian('A ==highlighted phrase== here.\n');
    expect(html).toContain('<mark>highlighted phrase</mark>');
  });

  test('OBS-4: unmatched == is left as literal text', () => {
    const html = parseObsidian('A == lone marker.\n');
    expect(html).not.toContain('<mark>');
    expect(html).toContain('== lone marker');
  });

  test('OBS-5: plain [[Target]] renders as an obs-wikilink span', () => {
    const html = parseObsidian('See [[Other Note]].\n');
    expect(html).toContain('class="obs-wikilink"');
    expect(html).toContain('data-wikilink="Other Note"');
    expect(html).toContain('>Other Note</a>');
  });

  test('OBS-6: [[Target|alias]] renders with alias as link text', () => {
    const html = parseObsidian('See [[Other Note|the other one]].\n');
    expect(html).toContain('data-wikilink="Other Note"');
    expect(html).toContain('data-alias="the other one"');
    expect(html).toContain('>the other one</a>');
  });

  test('OBS-7: [[Target#heading]] captures the anchor', () => {
    const html = parseObsidian('See [[Note#Section]].\n');
    expect(html).toContain('data-wikilink="Note"');
    expect(html).toContain('data-anchor="Section"');
    expect(html).toContain('>Note#Section</a>');
  });

  test('OBS-7: [[Target#^block]] captures the block anchor', () => {
    const html = parseObsidian('See [[Note#^abc123]].\n');
    expect(html).toContain('data-anchor="^abc123"');
  });

  test('OBS-8: ![[image.png]] renders an <img> with data-embed', () => {
    const html = parseObsidian('![[diagram.png]]\n');
    expect(html).toContain('<img');
    expect(html).toContain('data-embed="diagram.png"');
    expect(html).toContain('alt="diagram.png"');
  });

  test('OBS-8: image embeds recognize jpg, gif, webp, svg', () => {
    for (const ext of ['jpg', 'gif', 'webp', 'svg']) {
      const html = parseObsidian(`![[pic.${ext}]]\n`);
      expect(html).toContain('<img');
      expect(html).toContain(`data-embed="pic.${ext}"`);
    }
  });

  test('OBS-9: ![[note.md]] (non-image) renders an embed placeholder span', () => {
    const html = parseObsidian('![[Some Note]]\n');
    expect(html).toContain('class="obs-embed-placeholder"');
    expect(html).toContain('data-embed="Some Note"');
    expect(html).toContain('Some Note');
  });

  test('OBS-10: a simple [!note] callout renders with the callout class', () => {
    const source = '> [!note]\n> A reminder.\n';
    const html = parseObsidian(source);
    expect(html).toContain('class="obs-callout obs-callout-note"');
    expect(html).toContain('A reminder.');
  });

  test('OBS-11: each known type maps to its own modifier class', () => {
    for (const type of ['info', 'tip', 'warning', 'danger', 'quote', 'abstract', 'example']) {
      const html = parseObsidian(`> [!${type}]\n> body\n`);
      expect(html).toContain(`obs-callout-${type}`);
    }
  });

  test('OBS-12: unknown callout types fall through to the note class', () => {
    const html = parseObsidian('> [!unknown]\n> body\n');
    expect(html).toContain('obs-callout-note');
  });

  test('OBS-13: callout title goes into the title element, body is markdown', () => {
    const source = '> [!warning] Watch out\n> Be **careful** here.\n> Really.\n';
    const html = parseObsidian(source);
    expect(html).toContain('class="obs-callout-title"');
    expect(html).toContain('Watch out');
    expect(html).toContain('<strong>careful</strong>');
    expect(html).toContain('Really.');
  });

  test('OBS-13: foldable +/- syntax is accepted and ignored (always expanded)', () => {
    expect(parseObsidian('> [!note]+\n> body\n')).toContain('obs-callout-note');
    expect(parseObsidian('> [!note]-\n> body\n')).toContain('obs-callout-note');
  });

  test('OBS-14: ```mermaid fences emit the obs-mermaid marker div', () => {
    const source = '```mermaid\ngraph LR\nA --> B\n```\n';
    const html = parseObsidian(source);
    expect(html).toContain('class="obs-mermaid"');
    expect(html).toContain('data-diagram="');
    // base64 of "graph LR\nA --> B" (marked strips the trailing newline from token.text)
    const expected = btoa('graph LR\nA --> B');
    expect(html).toContain(`data-diagram="${expected}"`);
  });

  test('OBS-15: non-mermaid fences render as <pre><code> like before', () => {
    const html = parseObsidian('```js\nconst x = 1;\n```\n');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('const x = 1;');
    expect(html).not.toContain('obs-mermaid');
  });

  test('OBS-15: bare ``` fences with no info string render as <pre><code>', () => {
    const html = parseObsidian('```\nplain\n```\n');
    expect(html).toContain('<pre><code>plain');
    expect(html).not.toContain('obs-mermaid');
  });
});
