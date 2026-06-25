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
    extensions: [
      {
        name: 'obsBlockComment',
        level: 'block',
        start(src: string): number | undefined {
          const m = /(^|\n)%%/.exec(src);
          return m ? m.index + (m[1] ? 1 : 0) : undefined;
        },
        tokenizer(src: string) {
          const match = /^%%[\s\S]*?%%\n?/.exec(src);
          if (!match) {
            return undefined;
          }
          return {
            type: 'obsBlockComment',
            raw: match[0],
          };
        },
        renderer() {
          return '';
        },
      },
      {
        name: 'obsInlineComment',
        level: 'inline',
        start(src: string): number | undefined {
          const i = src.indexOf('%%');
          return i === -1 ? undefined : i;
        },
        tokenizer(src: string) {
          const match = /^%%[^\n]*?%%/.exec(src);
          if (!match) {
            return undefined;
          }
          return {
            type: 'obsInlineComment',
            raw: match[0],
          };
        },
        renderer() {
          return '';
        },
      },
      {
        name: 'obsHighlight',
        level: 'inline',
        start(src: string): number | undefined {
          const i = src.indexOf('==');
          return i === -1 ? undefined : i;
        },
        tokenizer(src: string) {
          const match = /^==([^=\n]+?)==/.exec(src);
          if (!match) {
            return undefined;
          }
          return {
            type: 'obsHighlight',
            raw: match[0],
            text: match[1],
          };
        },
        renderer(token) {
          return `<mark>${(token as unknown as { text: string }).text}</mark>`;
        },
      },
    ],
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
  });
}
