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
});
