# Obsidian-flavored markdown preview — design

Date: 2026-06-25
Status: Approved (brainstorm), pending implementation plan

## Goal

Extend the markdown preview so files using Obsidian-flavored syntax render correctly. Today the preview uses `marked` (GFM) + `DOMPurify` and treats Obsidian constructs as literal text or malformed markdown.

## Non-goals

- **Vault resolution**: wikilinks are styled and structurally tagged for future hookup, but a click does not resolve to another note. There is no "vault" inside a git repo.
- **Block-reference resolution**: `[[note#^block-id]]` parses and styles like a wikilink but does not embed the referenced block.
- **Dataview, Templater, plugin-specific syntax**: each is its own brainstorm.
- **Math (`$...$`, `$$...$$`)**: deferred — needs KaTeX (~280KB), not requested.
- **Hashtag styling (`#tag`)**: ambiguous with headings, low value without a tag panel.

## In-scope features

1. **Callouts** — `> [!type] Title\n> body lines` → styled callout box. Recognized types: `note`, `info`, `tip`, `warning`, `danger`, `quote`, `abstract`, `example`. Unknown types fall through to `note` styling. Foldable syntax (`+`/`-`) is parsed but ignored for v1 (always rendered expanded).
2. **Wikilinks** — `[[Target]]`, `[[Target|alias]]`, `[[Target#heading]]`, `[[Target#^block]]` → inline `<a class="obs-wikilink" href="#" data-wikilink="<target>" data-alias="<alias|>" data-anchor="<heading or ^block>">`. Non-resolving.
3. **Embeds** — `![[target]]`:
   - When `target` is an image extension recognized by `imageMime()` → `<img data-embed="<path>" alt="<target>">`. Resolved at mount time via the existing `readFile` RPC to a `data:` URL.
   - Otherwise → `<span class="obs-embed-placeholder" data-embed="<target>">Embedded: <target></span>`. No async resolution.
4. **Highlights** — `==text==` → `<mark>text</mark>`. Inline only.
5. **Comments** — `%%hidden%%` inline and ` %%\n…\n%% ` block → stripped from output (no marker, no whitespace artifact).
6. **Frontmatter** — leading `---\n…\n---\n` YAML block → stripped from output. Today `marked` mis-renders it as a horizontal-rule-wrapped heading.
7. **Mermaid** — ` ```mermaid …``` ` fence → rendered as inline SVG, lazy-loaded.

## Architecture

### Shared module: `src/shared/obsidianMarkdown.ts`

Exports a configured `marked` instance (or extension list applied to the singleton — TBD by impl) used by both `FilePreview.tsx` and `markdownDiff.ts`. Pure string → string. No DOM access. Runs unmodified under `bun test`.

Each in-scope feature is a `marked` extension:
- Block tokenizers: callouts, frontmatter, block comments, mermaid
- Inline tokenizers: wikilinks, embeds, highlights, inline comments

All tokenizers preserve `token.raw` so the block-level LCS in `markdownDiff.ts` keeps working without changes.

### Mermaid two-pass render

**Pass 1 — marker (sync, in `obsidianMarkdown.ts`):** the mermaid extension emits
`<div class="obs-mermaid" data-diagram="<base64(source)>"></div>`
instead of `<pre><code class="language-mermaid">`. Base64 sidesteps `DOMPurify` content escaping and quoting hazards.

**Pass 2 — render (async, in `FilePreview.tsx`):** a `useEffect` after the sanitized HTML is mounted:
- Queries `.obs-mermaid[data-diagram]` nodes
- If none, returns immediately (no import cost)
- Otherwise dynamically `import('mermaid')` and initializes once per session with the resolved theme
- For each node: decode source, call `mermaid.render(uniqueId, source)`, swap in the SVG
- On error: replace contents with `<div class="obs-mermaid-error"><p>{error}</p><pre>{source}</pre></div>`. Visible failure beats silent blank.

A module-level `Map<sha256(source), svgString>` cache short-circuits re-renders of the same diagram.

### Image embed render

`MarkdownPreview` gains a parallel `useEffect` that walks `img[data-embed]` and replaces `src` with a `data:` URL fetched via `api.readFile({ path, ref })`. Pattern mirrors `ImagePreview` at `src/mainview/components/FilePreview.tsx:71-117`.

**v1 always resolves embeds from the working tree** (`ref: undefined`), even inside the removed-box of a rich diff. This is a known limitation: a removed image embed will load whatever is currently in the working tree, not the old git version. Acceptable because (a) wiring per-side refs into `MarkdownPreview` requires changes well beyond this spec, and (b) for most embeds the file hasn't moved. A follow-up can thread refs through if it becomes a real problem.

When the image lookup fails (missing file, binary error), the `<img>` keeps its broken-image state — no special UI for v1.

### Theming (mermaid)

`mermaid.initialize` receives `theme: 'dark' | 'default'` from the resolved appearance theme. Theme changes invalidate the SVG cache and re-run the render pass (the resolved theme is in the `useEffect` dep array). Implementation reads the theme from the existing appearance store; exact accessor confirmed during impl.

### File-type gating

No change. `isMarkdownPath()` at `src/shared/preview.ts:34` already covers `.md`/`.markdown`/`.mdx`.

## Diff behavior

The rich-diff path (`markdownDiff.ts`) requires no new logic:

- **Callouts** are a new block token with a `.raw` covering the whole `> [!…]` … block. They diff as one block. Unchanged → plain render. Changed → removed-box / added-box pair. Container descent into callout body is a future enhancement, not v1.
- **Wikilinks / highlights / inline comments** inside a paragraph: any inline change still marks the whole paragraph as changed, identical to today's behavior for any inline edit.
- **Embeds** diff as paragraph or block changes depending on context; the image-resolution `useEffect` walks the full mounted tree, so embeds inside removed boxes also resolve (against the working tree — see the embed v1 limitation above).
- **Mermaid** is a code block at marked's level. The existing code-block diff path applies. Both panels render their diagram because the mermaid `useEffect` walks all `.obs-mermaid` nodes in the tree.
- **Frontmatter** is stripped before tokenization, so it disappears from both sides — diffs that only touch frontmatter render as no-op preview (the source diff in the file view still shows the change).

## Bundle cost

- Marked extensions: negligible (pure TS).
- Mermaid: ~1MB, imported via dynamic `import()` only, so vite produces a separate chunk fetched on demand. The plain render path never loads mermaid unless a `mermaid` fence is present.

Verify post-impl that `vite build` does not pull mermaid into the main chunk.

## Testing

### Unit (`bun test`)

New `src/shared/obsidianMarkdown.test.ts` covers, with pure string assertions:
- Callout: each type renders the expected class; unknown type falls through; multi-line body preserved
- Wikilink: plain, aliased, with `#heading`, with `#^block` — `data-*` attrs correct
- Embed: image extension → `<img data-embed>`; non-image → `<span class="obs-embed-placeholder">`
- Highlight: `==x==` → `<mark>x</mark>`; unmatched `==` left alone
- Comment: inline and block forms stripped; surrounding whitespace not mangled
- Frontmatter: stripped only when at file start; mid-file `---\n…\n---` left as horizontal rules
- Mermaid: produces `.obs-mermaid` marker with base64-encoded source; other fences (`js`, ` ``` ` with no info string) unchanged

Add cases to `src/mainview/components/markdownDiff.test.ts`:
- Add / remove / edit a callout
- Highlight added inside an unchanged paragraph → paragraph marked changed
- Embed swap (one filename → another)
- Mermaid diagram added; existing diagram edited

### E2E (Playwright)

One new test under `tests/`: a fixture file containing a mermaid block, callout, wikilink, and image embed. Assertions:
- `[data-testid="markdown-preview"] svg` appears (mermaid rendered)
- Callout box has the expected class
- Wikilink renders with `data-wikilink`
- Image embed `<img>` has a `data:` `src` after mount

### Manual

Drop a real Obsidian note into `tests/fixtures/`, view via `vite-web` preview at `/web.html?fixture=basic`. Spot-check rendering of every in-scope construct.

## Open questions deferred to implementation

- Exact accessor for the resolved appearance theme (store selector vs. DOM attribute).
- Whether to apply the marked extensions to the default singleton or expose a configured local instance — depends on whether anything else in the app currently uses the default `marked` import.
- Whether `obsidianMarkdown.ts` exports a single `parse(source)` function or just the extensions list (callers do `marked.parse`).

These are local decisions that won't change the architecture.
