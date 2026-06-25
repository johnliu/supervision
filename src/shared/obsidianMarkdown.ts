// Obsidian-flavored markdown: registers marked extensions for callouts,
// wikilinks, embeds, highlights, comments, frontmatter, and mermaid. The
// extensions live on the marked singleton (idempotent registration), so any
// caller — FilePreview's parse, markdownDiff's lexer/parser — sees the same
// behavior.

import { marked } from 'marked';
import { imageMime } from './preview';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

const CALLOUT_TYPES = new Set(['note', 'info', 'tip', 'warning', 'danger', 'quote', 'abstract', 'example']);

function stripFrontmatter(source: string): string {
  return source.replace(FRONTMATTER, '');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// SVG is treated as an image for embed purposes — imageMime doesn't cover it
// (we don't render arbitrary SVG in ImagePreview), but <img src="...svg"> works.
function isEmbedImage(target: string): boolean {
  if (imageMime(target)) {
    return true;
  }
  return target.toLowerCase().endsWith('.svg');
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
      {
        name: 'obsEmbed',
        level: 'inline',
        start(src: string): number | undefined {
          const i = src.indexOf('![[');
          return i === -1 ? undefined : i;
        },
        tokenizer(src: string) {
          const match = /^!\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
          if (!match) {
            return undefined;
          }
          return {
            type: 'obsEmbed',
            raw: match[0],
            target: match[1],
            alias: match[2] ?? '',
          };
        },
        renderer(token) {
          const t = token as unknown as { target: string; alias: string };
          const label = t.alias || t.target;
          if (isEmbedImage(t.target)) {
            return `<img data-embed="${escapeAttr(t.target)}" alt="${escapeAttr(label)}">`;
          }
          return `<span class="obs-embed-placeholder" data-embed="${escapeAttr(t.target)}">${escapeHtml(label)}</span>`;
        },
      },
      {
        name: 'obsWikilink',
        level: 'inline',
        start(src: string): number | undefined {
          const i = src.indexOf('[[');
          return i === -1 ? undefined : i;
        },
        tokenizer(src: string) {
          // Embeds (![[...]]) are claimed by obsEmbed; this matches the bare
          // wikilink form only.
          const match = /^\[\[([^\]\n|#]+)(?:#([^\]\n|]+))?(?:\|([^\]\n]+))?\]\]/.exec(src);
          if (!match) {
            return undefined;
          }
          return {
            type: 'obsWikilink',
            raw: match[0],
            target: match[1],
            anchor: match[2] ?? '',
            alias: match[3] ?? '',
          };
        },
        renderer(token) {
          const t = token as unknown as { target: string; anchor: string; alias: string };
          const display = t.alias || (t.anchor ? `${t.target}#${t.anchor}` : t.target);
          const anchorAttr = t.anchor ? ` data-anchor="${escapeAttr(t.anchor)}"` : '';
          const aliasAttr = t.alias ? ` data-alias="${escapeAttr(t.alias)}"` : '';
          return `<a class="obs-wikilink" href="#" data-wikilink="${escapeAttr(t.target)}"${anchorAttr}${aliasAttr}>${escapeHtml(display)}</a>`;
        },
      },
      {
        name: 'obsCallout',
        level: 'block',
        start(src: string): number | undefined {
          const m = /(^|\n)> \[!/.exec(src);
          return m ? m.index + (m[1] ? 1 : 0) : undefined;
        },
        tokenizer(src: string) {
          // Match the header line + all subsequent `> `-prefixed lines.
          const header = /^> \[!([a-zA-Z]+)\][+-]?(?:[ \t]+([^\n]*))?\n?/.exec(src);
          if (!header) {
            return undefined;
          }
          let consumed = header[0].length;
          const bodyLines: string[] = [];
          while (consumed < src.length) {
            const rest = src.slice(consumed);
            const lineEnd = rest.indexOf('\n');
            const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
            if (!line.startsWith('>')) {
              break;
            }
            // Strip the leading `>` and one optional space.
            bodyLines.push(line.replace(/^> ?/, ''));
            consumed += (lineEnd === -1 ? line.length : lineEnd + 1);
          }
          const body = bodyLines.join('\n');
          const inferredType = header[1].toLowerCase();
          const type = CALLOUT_TYPES.has(inferredType) ? inferredType : 'note';
          const title = (header[2] ?? '').trim();
          const bodyTokens = (this as unknown as { lexer: { blockTokens(s: string): import('marked').Token[] } }).lexer.blockTokens(body);
          return {
            type: 'obsCallout',
            raw: src.slice(0, consumed),
            calloutType: type,
            title,
            tokens: bodyTokens,
          };
        },
        renderer(token) {
          const t = token as unknown as { calloutType: string; title: string; tokens: import('marked').Token[] };
          const titleText = t.title || titleCase(t.calloutType);
          const body = (this as unknown as { parser: { parse(tokens: import('marked').Token[]): string } }).parser.parse(t.tokens);
          return `<div class="obs-callout obs-callout-${t.calloutType}"><div class="obs-callout-title">${escapeHtml(titleText)}</div><div class="obs-callout-body">${body}</div></div>`;
        },
      },
    ],
    renderer: {
      code(token) {
        // marked's `code` token shape: { type, raw, lang, text }
        const t = token as unknown as { lang?: string; text: string };
        if ((t.lang ?? '').trim().toLowerCase() === 'mermaid') {
          // base64 keeps DOMPurify happy and avoids quoting headaches for
          // raw <, >, &, " in the diagram source.
          const encoded = btoa(unescape(encodeURIComponent(t.text)));
          return `<div class="obs-mermaid" data-diagram="${encoded}"></div>`;
        }
        // false → fall through to marked's default code renderer.
        return false;
      },
    },
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
