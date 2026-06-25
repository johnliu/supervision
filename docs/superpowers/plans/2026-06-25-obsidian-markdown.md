# Obsidian-Flavored Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the in-app markdown preview so files using Obsidian-flavored syntax (callouts, wikilinks, embeds, highlights, comments, frontmatter, mermaid) render correctly in both the plain render and the rich-diff render.

**Architecture:** A new shared module `src/shared/obsidianMarkdown.ts` registers `marked` extensions on the singleton via `marked.use(...)` at import time. `FilePreview.tsx` and `markdownDiff.ts` both pick up the extensions because they import the singleton. Mermaid uses a sync marker token + async React `useEffect` that lazy-loads `mermaid` and renders SVG. Image embeds use the same pattern — sync `<img data-embed>` token + async `useEffect` that fetches bytes via the existing `readFile` RPC.

**Tech Stack:** TypeScript, React 19, `marked` v18 (already installed), `mermaid` v11 (new, lazy-loaded), `bun test` (unit), Playwright (e2e), Tailwind (CSS).

**Spec:** `docs/superpowers/specs/2026-06-25-obsidian-markdown-design.md`

**Project conventions:**
- All shell commands run inside devbox: `devbox run -- <cmd>` (per `~/.claude/CLAUDE.md`).
- Use `command git` to bypass the scmpuff wrapper.
- Tests use `bun:test`. The unit test naming follows existing patterns (see `markdownDiff.test.ts`). We use `OBS-N` as test ID prefix; the spec-coverage script (`scripts/check-spec-coverage.ts`) only enforces a fixed prefix list (STOP/EXP/NAV/CUR/SEL/SCR/FILE), so `OBS-N` is safe but unenforced.
- File format: no top-of-file docblock unless the file warrants explanation. See `src/mainview/components/markdownDiff.ts` for the right tone.

---

## File Structure

**Create:**
- `src/shared/obsidianMarkdown.ts` — `marked` extensions + side-effect registration + `parseObsidian(source)` helper
- `src/shared/obsidianMarkdown.test.ts` — unit tests (OBS-N IDs)
- `src/mainview/components/useMermaidRender.ts` — React hook (lazy-load + render)
- `src/mainview/components/useEmbedImages.ts` — React hook (image embed → data URL)
- `src/mainview/web/fixtures/obsidian.ts` — fixture scenario with an Obsidian-flavored markdown file
- `tests/e2e/obsidian.e2e.ts` — Playwright e2e

**Modify:**
- `src/mainview/components/FilePreview.tsx` — use `parseObsidian`, call hooks
- `src/mainview/components/markdownDiff.ts` — import `obsidianMarkdown` for side effect
- `src/mainview/components/markdownDiff.test.ts` — diff cases for callouts/highlights/embeds/mermaid
- `src/mainview/index.css` — styles for new constructs
- `src/mainview/web/fixtures/index.ts` — register `obsidian` fixture
- `package.json` — add `mermaid` dependency

---

## Task 1: Skeleton + frontmatter stripping

**Files:**
- Create: `src/shared/obsidianMarkdown.ts`
- Create: `src/shared/obsidianMarkdown.test.ts`

- [ ] **Step 1: Write the failing tests for frontmatter handling**

Create `src/shared/obsidianMarkdown.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: FAIL — module `./obsidianMarkdown` not found.

- [ ] **Step 3: Create `obsidianMarkdown.ts` with frontmatter preprocess + `parseObsidian`**

Create `src/shared/obsidianMarkdown.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
command git add src/shared/obsidianMarkdown.ts src/shared/obsidianMarkdown.test.ts
command git commit -m "Strip Obsidian YAML frontmatter from preview"
```

---

## Task 2: Comments (inline + block)

**Files:**
- Modify: `src/shared/obsidianMarkdown.ts`
- Modify: `src/shared/obsidianMarkdown.test.ts`

- [ ] **Step 1: Add failing tests for comment stripping**

Append to `src/shared/obsidianMarkdown.test.ts` (inside the `describe` block):

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: 3 FAIL (the 2 from Task 1 still pass).

- [ ] **Step 3: Implement comment tokenizers**

In `src/shared/obsidianMarkdown.ts`, add inside the `marked.use({...})` call:

```typescript
  marked.use({
    gfm: true,
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
    ],
    hooks: {
      preprocess(markdown: string): string {
        return stripFrontmatter(markdown);
      },
    },
  });
```

(The full `marked.use(...)` call now has both `extensions` and `hooks`. Replace the existing call wholesale.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
command git add src/shared/obsidianMarkdown.ts src/shared/obsidianMarkdown.test.ts
command git commit -m "Strip Obsidian %% comments from preview"
```

---

## Task 3: Highlights

**Files:**
- Modify: `src/shared/obsidianMarkdown.ts`
- Modify: `src/shared/obsidianMarkdown.test.ts`

- [ ] **Step 1: Add failing tests for highlights**

Append:

```typescript
  test('OBS-4: ==text== renders as <mark>text</mark>', () => {
    const html = parseObsidian('A ==highlighted phrase== here.\n');
    expect(html).toContain('<mark>highlighted phrase</mark>');
  });

  test('OBS-4: unmatched == is left as literal text', () => {
    const html = parseObsidian('A == lone marker.\n');
    expect(html).not.toContain('<mark>');
    expect(html).toContain('== lone marker');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: 2 FAIL.

- [ ] **Step 3: Implement the highlight tokenizer**

Add to the `extensions` array in `src/shared/obsidianMarkdown.ts`:

```typescript
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
          return `<mark>${(token as { text: string }).text}</mark>`;
        },
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
command git add src/shared/obsidianMarkdown.ts src/shared/obsidianMarkdown.test.ts
command git commit -m "Render Obsidian ==highlight== as <mark>"
```

---

## Task 4: Wikilinks

**Files:**
- Modify: `src/shared/obsidianMarkdown.ts`
- Modify: `src/shared/obsidianMarkdown.test.ts`

- [ ] **Step 1: Add failing tests for wikilinks**

Append:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: 4 FAIL.

- [ ] **Step 3: Implement the wikilink tokenizer**

Add to the `extensions` array (after the highlight extension):

```typescript
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
          const t = token as { target: string; anchor: string; alias: string };
          const display = t.alias || (t.anchor ? `${t.target}#${t.anchor}` : t.target);
          const anchorAttr = t.anchor ? ` data-anchor="${escapeAttr(t.anchor)}"` : '';
          const aliasAttr = t.alias ? ` data-alias="${escapeAttr(t.alias)}"` : '';
          return `<a class="obs-wikilink" href="#" data-wikilink="${escapeAttr(t.target)}"${anchorAttr}${aliasAttr}>${escapeHtml(display)}</a>`;
        },
      },
```

Also add these helpers near the top of `obsidianMarkdown.ts` (above `register`):

```typescript
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
command git add src/shared/obsidianMarkdown.ts src/shared/obsidianMarkdown.test.ts
command git commit -m "Render Obsidian [[wikilinks]] with structured data attrs"
```

---

## Task 5: Embeds

**Files:**
- Modify: `src/shared/obsidianMarkdown.ts`
- Modify: `src/shared/obsidianMarkdown.test.ts`

- [ ] **Step 1: Add failing tests for embeds**

Append:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: 3 FAIL.

- [ ] **Step 3: Implement the embed tokenizer**

At the top of `src/shared/obsidianMarkdown.ts`, add the import:

```typescript
import { imageMime } from './preview';
```

Treat SVG as an image for embed purposes (it isn't in `imageMime` today because we don't render arbitrary SVG in `ImagePreview`, but as an `<img src="data:image/svg+xml,...">` it works fine for an embed). Add this helper near `escapeAttr`:

```typescript
function isEmbedImage(target: string): boolean {
  if (imageMime(target)) {
    return true;
  }
  return target.toLowerCase().endsWith('.svg');
}
```

Add to the `extensions` array (before `obsWikilink` so the embed matches first):

```typescript
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
          const t = token as { target: string; alias: string };
          const label = t.alias || t.target;
          if (isEmbedImage(t.target)) {
            return `<img data-embed="${escapeAttr(t.target)}" alt="${escapeAttr(label)}">`;
          }
          return `<span class="obs-embed-placeholder" data-embed="${escapeAttr(t.target)}">${escapeHtml(label)}</span>`;
        },
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
command git add src/shared/obsidianMarkdown.ts src/shared/obsidianMarkdown.test.ts
command git commit -m "Render Obsidian ![[embeds]] as <img> or placeholder"
```

---

## Task 6: Callouts

**Files:**
- Modify: `src/shared/obsidianMarkdown.ts`
- Modify: `src/shared/obsidianMarkdown.test.ts`

- [ ] **Step 1: Add failing tests for callouts**

Append:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: 5 FAIL.

- [ ] **Step 3: Implement the callout tokenizer**

Add this constant near the top of `src/shared/obsidianMarkdown.ts`:

```typescript
const CALLOUT_TYPES = new Set(['note', 'info', 'tip', 'warning', 'danger', 'quote', 'abstract', 'example']);
```

Add to the `extensions` array:

```typescript
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
          const bodyTokens = this.lexer.blockTokens(body);
          return {
            type: 'obsCallout',
            raw: src.slice(0, consumed),
            calloutType: type,
            title,
            tokens: bodyTokens,
          };
        },
        renderer(token) {
          const t = token as { calloutType: string; title: string; tokens: import('marked').Token[] };
          const titleText = t.title || titleCase(t.calloutType);
          const body = this.parser.parse(t.tokens);
          return `<div class="obs-callout obs-callout-${t.calloutType}"><div class="obs-callout-title">${escapeHtml(titleText)}</div><div class="obs-callout-body">${body}</div></div>`;
        },
      },
```

Add the helper `titleCase` near the others:

```typescript
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

The `childTokens` field is not needed since the body tokens are accessed via `this.parser.parse(token.tokens)` directly — that integrates with marked's normal sub-token rendering.

- [ ] **Step 4: Run tests to verify they pass**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
command git add src/shared/obsidianMarkdown.ts src/shared/obsidianMarkdown.test.ts
command git commit -m "Render Obsidian > [!type] callouts as styled boxes"
```

---

## Task 7: Mermaid marker

**Files:**
- Modify: `src/shared/obsidianMarkdown.ts`
- Modify: `src/shared/obsidianMarkdown.test.ts`

This task only emits the sync marker `<div class="obs-mermaid" data-diagram="<base64>">`. The async SVG render lands in Task 11.

- [ ] **Step 1: Add failing tests for the mermaid marker**

Append:

```typescript
  test('OBS-14: ```mermaid fences emit the obs-mermaid marker div', () => {
    const source = '```mermaid\ngraph LR\nA --> B\n```\n';
    const html = parseObsidian(source);
    expect(html).toContain('class="obs-mermaid"');
    expect(html).toContain('data-diagram="');
    // base64 of "graph LR\nA --> B\n"
    const expected = btoa('graph LR\nA --> B\n');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: 1 FAIL (the mermaid case). The other two likely pass already.

- [ ] **Step 3: Implement the mermaid renderer override**

In the `marked.use({...})` call, add a `renderer` block alongside `extensions` and `hooks`:

```typescript
    renderer: {
      code(token) {
        // marked's `code` token shape: { type, raw, lang, text }
        const t = token as { lang?: string; text: string };
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
```

(`btoa(unescape(encodeURIComponent(...)))` is the safe UTF-8-aware base64 encoding for non-ASCII diagram text.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `devbox run -- bun test src/shared/obsidianMarkdown.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 5: Commit**

```bash
command git add src/shared/obsidianMarkdown.ts src/shared/obsidianMarkdown.test.ts
command git commit -m "Emit marker div for ```mermaid fences in preview"
```

---

## Task 8: Wire `obsidianMarkdown` into `FilePreview` and `markdownDiff`

**Files:**
- Modify: `src/mainview/components/FilePreview.tsx` (lines 11-14 imports, lines 21-36 useMemo)
- Modify: `src/mainview/components/markdownDiff.ts` (lines 26-27 imports)

- [ ] **Step 1: Run existing tests to establish the pre-change baseline**

Run: `devbox run -- bun test src/mainview/components/markdownDiff.test.ts`
Expected: PASS (15 tests, MDD-1 through MDD-15).

- [ ] **Step 2: Modify `FilePreview.tsx` to use `parseObsidian`**

Replace lines 11-14 of `src/mainview/components/FilePreview.tsx`:

Current:
```typescript
import DOMPurify from 'dompurify';
import { ImageOff, LoaderCircle } from 'lucide-react';
import { marked } from 'marked';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
```

New:
```typescript
import DOMPurify from 'dompurify';
import { ImageOff, LoaderCircle } from 'lucide-react';
import { parseObsidian } from '../../shared/obsidianMarkdown';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
```

Replace the body of `useMemo` (currently lines 21-32):

Current:
```typescript
  const html = useMemo(() => {
    const rich = oldSource.length > 0 && oldSource !== source;
    return DOMPurify.sanitize(
      rich
        ? renderMarkdownDiff(oldSource, source)
        : marked.parse(source, {
            gfm: true,
            async: false,
          }),
    );
  }, [
    source,
    oldSource,
  ]);
```

New:
```typescript
  const html = useMemo(() => {
    const rich = oldSource.length > 0 && oldSource !== source;
    return DOMPurify.sanitize(rich ? renderMarkdownDiff(oldSource, source) : parseObsidian(source));
  }, [
    source,
    oldSource,
  ]);
```

- [ ] **Step 3: Modify `markdownDiff.ts` to register the extensions via side effect**

In `src/mainview/components/markdownDiff.ts`, change the marked import block. Current line 26:

```typescript
import { marked, type Token, type Tokens } from 'marked';
```

Add directly after it:

```typescript
import '../../shared/obsidianMarkdown';
```

- [ ] **Step 4: Run unit tests and typecheck**

Run: `devbox run -- bun test src/`
Expected: PASS — all OBS-* and MDD-* tests green.

Run: `devbox run -- bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
command git add src/mainview/components/FilePreview.tsx src/mainview/components/markdownDiff.ts
command git commit -m "Wire Obsidian markdown extensions into preview + rich diff"
```

---

## Task 9: Image-embed React hook

**Files:**
- Create: `src/mainview/components/useEmbedImages.ts`
- Modify: `src/mainview/components/FilePreview.tsx`

- [ ] **Step 1: Create the hook**

Create `src/mainview/components/useEmbedImages.ts`:

```typescript
import { type RefObject, useEffect } from 'react';
import { api } from '../platform';

// Walks the rendered tree for img[data-embed="<path>"] and swaps in a data:
// URL fetched via readFile. v1 always uses the working-tree ref (undefined);
// per-side ref threading is a future enhancement (see design spec).
export function useEmbedImages(containerRef: RefObject<HTMLElement | null>, htmlSignal: string): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const nodes = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-embed]'));
    if (nodes.length === 0) {
      return;
    }
    let cancelled = false;
    for (const img of nodes) {
      const path = img.getAttribute('data-embed');
      if (!path) {
        continue;
      }
      api
        .readFile({ path })
        .then((payload) => {
          if (cancelled || !payload.ok) {
            return;
          }
          img.src = `data:${payload.mime};base64,${payload.base64}`;
        })
        .catch(() => {
          // Broken image state is fine; no special UI for v1.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [containerRef, htmlSignal]);
}
```

- [ ] **Step 2: Wire it into `MarkdownPreview`**

In `src/mainview/components/FilePreview.tsx`, add to the imports:

```typescript
import { useRef } from 'react';
import { useEmbedImages } from './useEmbedImages';
```

(Merge `useRef` into the existing `react` import if you prefer — that import already pulls `useEffect`, `useMemo`, `useState`. The end form should be `import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';`.)

Update the `MarkdownPreview` function. After the `useMemo` block, add:

```typescript
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEmbedImages(containerRef, html);
```

Attach the ref to the inner div that receives `dangerouslySetInnerHTML`:

```jsx
      <div
        ref={containerRef}
        className="markdown-preview mx-auto max-w-3xl px-8 py-8"
        style={...}
        dangerouslySetInnerHTML={...}
      />
```

- [ ] **Step 3: Manual check via web preview**

Run: `devbox run -- bun run dev:web` (opens `/web.html`).

This task has no automated test for the async swap — the next round of e2e (Task 14) covers it. Manual check is sufficient here.

Expected: starting the dev server succeeds; no console errors. (Embed resolution is exercised in Task 14.)

- [ ] **Step 4: Typecheck**

Run: `devbox run -- bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
command git add src/mainview/components/useEmbedImages.ts src/mainview/components/FilePreview.tsx
command git commit -m "Resolve Obsidian image embeds via readFile RPC"
```

---

## Task 10: Add `mermaid` dependency

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Install mermaid**

Run: `devbox run -- bun add mermaid@^11`

Expected: `package.json` gets a `"mermaid": "^11.x.x"` entry under `dependencies`; `bun.lock` updates.

- [ ] **Step 2: Verify dynamic-import shape works**

Quick sanity check that mermaid v11 exposes a default export with `initialize` and `render`:

Run: `devbox run -- bun -e 'const m = await import("mermaid"); console.log(typeof m.default?.initialize, typeof m.default?.render)'`
Expected: `function function`

- [ ] **Step 3: Commit**

```bash
command git add package.json bun.lock
command git commit -m "Add mermaid dependency for diagram rendering"
```

---

## Task 11: Mermaid React hook

**Files:**
- Create: `src/mainview/components/useMermaidRender.ts`
- Modify: `src/mainview/components/FilePreview.tsx`

- [ ] **Step 1: Create the hook**

Create `src/mainview/components/useMermaidRender.ts`:

```typescript
import { type RefObject, useEffect } from 'react';
import { resolveThemeType, useReviewStore } from '../store';

// Lazily imports mermaid the first time a diagram appears, then renders every
// `.obs-mermaid[data-diagram]` in the container. Re-renders when the resolved
// theme changes. SVG output is cached per (theme, source) so scrolling /
// re-mounts don't re-render.

type MermaidApi = {
  initialize(config: { startOnLoad: boolean; theme: 'dark' | 'default'; securityLevel: 'strict' }): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let currentTheme: 'dark' | 'default' | null = null;
const cache = new Map<string, string>();
let nextId = 0;

async function loadMermaid(theme: 'dark' | 'default'): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default as unknown as MermaidApi);
  }
  const mermaid = await mermaidPromise;
  if (currentTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
    currentTheme = theme;
    cache.clear();
  }
  return mermaid;
}

function cacheKey(theme: 'dark' | 'default', source: string): string {
  return `${theme}\x1f${source}`;
}

function decode(b64: string): string {
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return atob(b64);
  }
}

export function useMermaidRender(containerRef: RefObject<HTMLElement | null>, htmlSignal: string): void {
  const themeType = useReviewStore((state) => resolveThemeType(state.theme, state.systemDark));
  const mermaidTheme: 'dark' | 'default' = themeType === 'dark' ? 'dark' : 'default';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const nodes = Array.from(container.querySelectorAll<HTMLDivElement>('.obs-mermaid[data-diagram]'));
    if (nodes.length === 0) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const mermaid = await loadMermaid(mermaidTheme);
      if (cancelled) {
        return;
      }
      for (const node of nodes) {
        const encoded = node.getAttribute('data-diagram') ?? '';
        const source = decode(encoded);
        const key = cacheKey(mermaidTheme, source);
        const hit = cache.get(key);
        if (hit !== undefined) {
          node.innerHTML = hit;
          continue;
        }
        try {
          const id = `obs-mermaid-${nextId++}`;
          const { svg } = await mermaid.render(id, source);
          if (cancelled) {
            return;
          }
          cache.set(key, svg);
          node.innerHTML = svg;
        } catch (err) {
          if (cancelled) {
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          node.innerHTML = `<div class="obs-mermaid-error"><p>${msg.replace(/</g, '&lt;')}</p><pre>${source.replace(/</g, '&lt;')}</pre></div>`;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [containerRef, htmlSignal, mermaidTheme]);
}
```

- [ ] **Step 2: Wire it into `MarkdownPreview`**

In `src/mainview/components/FilePreview.tsx`, add:

```typescript
import { useMermaidRender } from './useMermaidRender';
```

Below the existing `useEmbedImages(containerRef, html);` call, add:

```typescript
  useMermaidRender(containerRef, html);
```

- [ ] **Step 3: Manual check**

Run: `devbox run -- bun run dev:web`

Manually load a markdown fixture with a mermaid block (Task 14 will add a proper fixture, but you can edit one inline for now).

Expected: a mermaid block renders as SVG. No console errors. Toggling theme re-renders.

- [ ] **Step 4: Typecheck**

Run: `devbox run -- bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
command git add src/mainview/components/useMermaidRender.ts src/mainview/components/FilePreview.tsx
command git commit -m "Render mermaid diagrams via lazy-loaded import"
```

---

## Task 12: Styles for new constructs

**Files:**
- Modify: `src/mainview/index.css` (append after line 288, before the closing `}` of `@layer components`)

- [ ] **Step 1: Add CSS for callouts, wikilinks, highlights, embeds, mermaid**

Open `src/mainview/index.css` and locate the end of the `@layer components` block (currently line 288). Inside the block, append these rules:

```css
  /* Obsidian callouts (obsidianMarkdown.ts). */
  .markdown-preview .obs-callout {
    @apply my-3 rounded-md border-l-3 px-3 py-2;
    background: color-mix(in oklab, var(--muted) 50%, transparent);
  }
  .markdown-preview .obs-callout-title {
    @apply mb-1 font-semibold;
  }
  .markdown-preview .obs-callout > :is(.obs-callout-body) > :first-child {
    @apply mt-0;
  }
  .markdown-preview .obs-callout > :is(.obs-callout-body) > :last-child {
    @apply mb-0;
  }
  .markdown-preview .obs-callout-note {
    border-left-color: #64748b;
  }
  .markdown-preview .obs-callout-info,
  .markdown-preview .obs-callout-tip {
    border-left-color: #0ea5e9;
    background: color-mix(in oklab, #0ea5e9 8%, transparent);
  }
  .markdown-preview .obs-callout-warning {
    border-left-color: #f59e0b;
    background: color-mix(in oklab, #f59e0b 8%, transparent);
  }
  .markdown-preview .obs-callout-danger {
    border-left-color: #ef4444;
    background: color-mix(in oklab, #ef4444 8%, transparent);
  }
  .markdown-preview .obs-callout-abstract,
  .markdown-preview .obs-callout-example,
  .markdown-preview .obs-callout-quote {
    border-left-color: #8b5cf6;
    background: color-mix(in oklab, #8b5cf6 8%, transparent);
  }

  /* Obsidian wikilinks: distinct from external links so the reader knows
     they're non-resolving (cursor stays default; no underline). */
  .markdown-preview .obs-wikilink {
    @apply rounded-sm px-0.5 text-primary no-underline cursor-default;
    background: color-mix(in oklab, var(--primary) 8%, transparent);
  }

  /* Obsidian highlights. */
  .markdown-preview mark {
    @apply rounded-sm px-0.5;
    background: color-mix(in oklab, #facc15 35%, transparent);
    color: inherit;
  }

  /* Obsidian non-image embeds. */
  .markdown-preview .obs-embed-placeholder {
    @apply inline-block rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground;
  }

  /* Obsidian mermaid containers + error fallback. */
  .markdown-preview .obs-mermaid {
    @apply my-3 flex justify-center;
  }
  .markdown-preview .obs-mermaid svg {
    @apply max-w-full;
  }
  .markdown-preview .obs-mermaid-error {
    @apply my-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs;
  }
  .markdown-preview .obs-mermaid-error pre {
    @apply mt-2 overflow-x-auto;
  }
```

- [ ] **Step 2: Visual check**

Run: `devbox run -- bun run dev:web`

Browse to a markdown file containing the new constructs. Confirm each one paints visibly distinct (callouts boxed, wikilinks tinted, highlights yellow, etc.) in both light and dark themes.

- [ ] **Step 3: Commit**

```bash
command git add src/mainview/index.css
command git commit -m "Style Obsidian callouts, wikilinks, highlights, embeds, mermaid"
```

---

## Task 13: Rich-diff coverage for new constructs

**Files:**
- Modify: `src/mainview/components/markdownDiff.test.ts`

These cases verify that `markdownDiff.ts` continues to work correctly once the Obsidian extensions are registered. Most should pass without further code changes — the LCS works on `token.raw`.

- [ ] **Step 1: Add diff tests for callouts/highlights/embeds/mermaid**

Append inside the `describe` block in `src/mainview/components/markdownDiff.test.ts`:

```typescript
  test('MDD-16: an added callout boxes as md-block-added once', () => {
    const oldDoc = 'Intro.\n';
    const newDoc = 'Intro.\n\n> [!warning] Heads up\n> Don\'t do that.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({ added: 1, removed: 0 });
    expect(html).toContain('obs-callout-warning');
  });

  test('MDD-17: an edited callout body shows old above new', () => {
    const oldDoc = '> [!note]\n> Original.\n';
    const newDoc = '> [!note]\n> Rewritten.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({ added: 1, removed: 1 });
    expect(html.indexOf('Original')).toBeLessThan(html.indexOf('Rewritten'));
  });

  test('MDD-18: a highlight added in a paragraph marks the whole paragraph', () => {
    const oldDoc = 'Hello world.\n';
    const newDoc = 'Hello ==bright== world.\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({ added: 1, removed: 1 });
    expect(html).toContain('<mark>bright</mark>');
  });

  test('MDD-19: a swapped image embed boxes as a paragraph change', () => {
    const oldDoc = '![[before.png]]\n';
    const newDoc = '![[after.png]]\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({ added: 1, removed: 1 });
    expect(html).toContain('data-embed="before.png"');
    expect(html).toContain('data-embed="after.png"');
  });

  test('MDD-20: an added mermaid diagram boxes as md-block-added with the marker', () => {
    const oldDoc = 'Plain prose.\n';
    const newDoc = 'Plain prose.\n\n```mermaid\ngraph LR\nA --> B\n```\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({ added: 1, removed: 0 });
    expect(html).toContain('class="obs-mermaid"');
  });

  test('MDD-21: an edited mermaid diagram shows both markers (old above new)', () => {
    const oldDoc = '```mermaid\ngraph LR\nA --> B\n```\n';
    const newDoc = '```mermaid\ngraph LR\nA --> C\n```\n';
    const html = renderMarkdownDiff(oldDoc, newDoc);
    expect(counts(html)).toEqual({ added: 1, removed: 1 });
    // Both versions retain their marker div so the React effect can render
    // each independently.
    expect((html.match(/class="obs-mermaid"/g) ?? []).length).toBe(2);
  });
```

- [ ] **Step 2: Run tests**

Run: `devbox run -- bun test src/mainview/components/markdownDiff.test.ts`
Expected: PASS (21 tests, MDD-1 through MDD-21).

- [ ] **Step 3: Commit**

```bash
command git add src/mainview/components/markdownDiff.test.ts
command git commit -m "Cover Obsidian constructs in markdown rich-diff tests"
```

---

## Task 14: E2E test + Obsidian fixture

**Files:**
- Create: `src/mainview/web/fixtures/obsidian.ts`
- Modify: `src/mainview/web/fixtures/index.ts`
- Create: `tests/e2e/obsidian.e2e.ts`

- [ ] **Step 1: Inspect existing fixture builders + helpers**

Skim these once before writing the new files:
- `src/mainview/web/fixtures/builders.ts` — for `makeFileChange`
- `tests/e2e/helpers.ts` — for `openFixture` (the entry point used by every e2e)

The fixture index is `src/mainview/web/fixtures/index.ts`; the registry shape is a `Record<string, () => FixtureData>` (see lines 12-20). The `FixtureData` shape (from `types.ts`) is `{ id, model, comments, config }`.

- [ ] **Step 2: Create the `obsidian` fixture scenario**

Create `src/mainview/web/fixtures/obsidian.ts`:

```typescript
import { makeFileChange } from './builders';
import type { FixtureData } from './types';

const OLD_NOTE = `# Project plan

Some intro.

> [!note]
> Original reminder.

Hello world.
`;

const NEW_NOTE = `---
title: Plan
tags: [a, b]
---

# Project plan

Some intro.

> [!warning] Heads up
> Don't merge before Friday.

Hello ==bright== world.

See [[Other Note|the other one]].

\`\`\`mermaid
graph LR
A --> B
B --> C
\`\`\`
`;

export function obsidian(): FixtureData {
  return {
    id: 'obsidian',
    model: {
      repoRoot: 'fixture://obsidian',
      compare: { kind: 'working' },
      reviewed: [],
      unreviewed: [
        makeFileChange({
          path: 'docs/plan.md',
          // joinContents appends a trailing newline; strip our own first.
          oldLines: OLD_NOTE.replace(/\n$/, '').split('\n'),
          newLines: NEW_NOTE.replace(/\n$/, '').split('\n'),
        }),
      ],
    },
    comments: [],
    config: { diffStyle: 'split', ignoreWhitespace: false },
  };
}
```

(If `FixtureData` requires fields beyond what's shown — check the file you read in Step 1 — add them with reasonable defaults. The shape above mirrors `basic.ts`.)

- [ ] **Step 3: Register the fixture**

Edit `src/mainview/web/fixtures/index.ts`:
1. Add `import { obsidian } from './obsidian';` near the other fixture imports.
2. Add `obsidian,` to the `registry` object alongside the existing entries.

- [ ] **Step 4: Write the failing e2e test**

Create `tests/e2e/obsidian.e2e.ts`:

```typescript
import { expect, test } from '@playwright/test';
import { openFixture, settle } from './helpers';

test.describe('OBS-E2E: Obsidian markdown preview', () => {
  test('renders callout, highlight, wikilink, and mermaid SVG', async ({ page }) => {
    await openFixture(page, { fixture: 'obsidian', file: 'docs/plan.md' });

    // Flip the preview toggle deterministically through the store.
    await page.evaluate(() => window.__test?.store.getState().togglePreview());
    await settle(page);

    const preview = page.getByTestId('markdown-preview');
    await expect(preview).toBeVisible();

    // Callout (renders synchronously).
    await expect(preview.locator('.obs-callout.obs-callout-warning')).toBeVisible();

    // Highlight.
    await expect(preview.locator('mark', { hasText: 'bright' })).toBeVisible();

    // Wikilink.
    await expect(preview.locator('a.obs-wikilink[data-wikilink="Other Note"]')).toBeVisible();

    // Mermaid: SVG appears once the async render lands.
    await expect(preview.locator('.obs-mermaid svg').first()).toBeVisible({ timeout: 5000 });
  });
});
```

Note: the `openFixture` helper waits for `[data-testid="diff-pane"]` — which is what mounts before the preview toggle is meaningful. The store-driven toggle avoids any flake from button-selector drift.

- [ ] **Step 5: Run the test**

Run: `devbox run -- bun run test:e2e -- obsidian.e2e.ts`
Expected: PASS. If selectors don't match, fix them; if the toggle is keyboard-only, use a keystroke; consult `tests/e2e/files.e2e.ts` for the working pattern.

- [ ] **Step 6: Commit**

```bash
command git add src/mainview/web/fixtures/obsidian.ts src/mainview/web/fixtures/index.ts tests/e2e/obsidian.e2e.ts
command git commit -m "E2E: render Obsidian-flavored markdown fixture end-to-end"
```

---

## Task 15: Full verification + bundle check

**Files:**
- None (verification only).

- [ ] **Step 1: Run the full suite**

Run: `devbox run -- bun run test`
Expected: typecheck + unit + check:specs + e2e all PASS.

If `bun run check` (biome) is part of your pre-merge flow, run it too:
Run: `devbox run -- bun run check`
Expected: no findings. (Memory note: biome-in-worktree noise is environmental — see `verify-supervision-changes.md`.)

- [ ] **Step 2: Bundle-cost check for mermaid lazy-loading**

Run: `devbox run -- bun run build:canary`
Then look at the produced `dist/` (path printed by `vite build`):
```bash
ls -lh dist/assets/ | grep -i mermaid
```
Expected: mermaid lands in its own chunk (filename contains `mermaid`), and the entry chunk size matches the pre-change baseline ±a few KB. If mermaid appears in the main chunk, the dynamic import was lost — investigate (likely a static `import 'mermaid'` slipped in somewhere).

- [ ] **Step 3: Manual smoke**

Run: `devbox run -- bun run dev:web` and open `/web.html?fixture=obsidian`.

Visually confirm:
- Frontmatter doesn't appear
- Callout renders styled
- Highlight visible
- Wikilink visible, non-clickable feel
- Mermaid renders as SVG
- Diff view of the same file shows the modified callout/highlight/embed/mermaid with marker boxes

- [ ] **Step 4: Commit (if any verification fixes were needed)**

```bash
command git status
# If clean, no commit needed.
```

---

## Notes & follow-ups (not part of this plan)

- **Behavior spec**: the project's `docs/specs/` system tracks normative behavior. A future PR can add `docs/specs/markdown-preview.md` and extend the `check-spec-coverage.ts` regex to include `OBS` and `MDD` prefixes. Not required for this work to land.
- **Per-side embed refs**: see the "v1 limitation" note in the design spec. Threading `gitRef` through `MarkdownPreview` lets removed-side embeds load from the old git version.
- **Math (`$...$`)**: same shape as mermaid — sync marker + async render. Would add KaTeX as a lazy chunk.
- **Wikilink resolution**: today they're styled spans. A future "open wikilink in editor" feature could hook the `data-wikilink` attribute.
