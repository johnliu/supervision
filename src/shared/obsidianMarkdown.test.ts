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
});
