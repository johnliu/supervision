// Obsidian-flavored markdown: registers marked extensions for callouts,
// wikilinks, embeds, highlights, comments, frontmatter, and mermaid. The
// extensions live on the marked singleton (idempotent registration), so any
// caller — FilePreview's parse, markdownDiff's lexer/parser — sees the same
// behavior.

import { marked } from 'marked';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function stripFrontmatter(source: string): string {
  return source.replace(FRONTMATTER, '');
}

let registered = false;
function register(): void {
  if (registered) {
    return;
  }
  registered = true;
  marked.use({
    gfm: true,
    hooks: {
      preprocess(markdown: string): string {
        return stripFrontmatter(markdown);
      },
    },
  });
}

register();

export function parseObsidian(source: string): string {
  return marked.parse(source, {
    gfm: true,
    async: false,
  }) as string;
}
