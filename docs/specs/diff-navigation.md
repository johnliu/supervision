# Diff navigation, selection, expansion, and scrolling

Spec for the diff pane (`src/mainview/components/DiffPane.tsx` +
`src/mainview/components/diffNav.ts`). See [README.md](README.md) for the ID /
coverage conventions.

## Terminology

- **Row** — one visual line of the rendered diff: a context line, a change
  line (addition/deletion), or a collapsed-context bar. In split view a row
  may span both columns.
- **Stop** — the keyboard cursor's unit of movement. The stop list is derived
  from the parsed diff (`buildNavStops`) and enumerates rows in render order.
  A **line stop** represents a code row (`line`, `side`, `addLine`,
  `delLine`, `change`); a **gap stop** represents a collapsed-context bar
  (`expandIndex`, `expandDirection`, hidden ranges on both sides).
- **Bar** — a collapsed-context separator ("N unmodified lines"). The bar
  before the first hunk is the **leading** bar; after the last hunk the
  **trailing** bar; others are **middle** bars.
- **Cursor** — where keyboard navigation acts from. Visually it is either the
  selected line (single-line selection) or a highlighted bar (the **bar
  cursor**). The bar cursor and the line selection can coexist; the bar
  cursor takes precedence while it is visible.
- **Anchor** — the fixed end of the selection. Set by clicks and by plain
  j/k landings; Shift+click and Shift+J/K extend from it.
- **Expansion map** — per-file record of how far each bar has been expanded
  (`fromStart`/`fromEnd` lines revealed from each end of the hidden range;
  `Infinity` = everything). It mirrors the renderer's own expansion state
  exactly; the renderer and the stop list must never disagree.
- **Hidden range** — the file lines a bar conceals, expressed in both old- and
  new-file numbering.
- **Logical scrollTop** — the scroll position as reported by the diff
  renderer (`onScroll`), used for all visibility math.
- Constants: **collapse threshold = 1** (hidden ranges of ≤ 1 line render in
  full), **expansion chunk = 100** lines, **nav margin = 40 px**.

## STOP — the stop model

Pure function of (parsed diff, view mode, expansion map). Unit-testable.

| ID | Behavior (MUST) | Notes | Covered by |
|----|-----------------|-------|------------|
| STOP-1 | The stop list enumerates exactly the rows the renderer draws, in top-to-bottom render order: context rows, change rows, and one gap stop per visible bar. | Same parsed diff feeds both; they cannot disagree. | unit (diffNav.test.ts) |
| STOP-2 | In unified view, a change group emits all deletion rows (side `deletions`) followed by all addition rows (side `additions`), one stop per line. | | unit (diffNav.test.ts) |
| STOP-3 | In split view, a change group emits `max(deletions, additions)` stops; stop *i* pairs deletion *i* with addition *i*. The stop's `side` is `additions` when an addition exists in that row, else `deletions`. | Mirrors the renderer's column alignment. | unit (diffNav.test.ts) |
| STOP-4 | A context row's stop carries both `addLine` and `delLine`; a selection on either side of that row resolves to the same stop. | Old-file N and new-file N are different rows in change blocks — only context rows unify them. | unit (diffNav.test.ts) |
| STOP-5 | Gap stops carry the expand direction the renderer's button performs: leading bar `down`, middle bars `both`, trailing bar `up`. | | unit (diffNav.test.ts) |
| STOP-6 | A hidden range of ≤ 1 line (the collapse threshold) produces context line stops, never a gap stop — matching the renderer, which draws no bar. | | unit (diffNav.test.ts) |
| STOP-7 | A gap stop's ranges (`addStart..addEnd`, `delStart..delEnd`) cover exactly the lines currently hidden — no more, no less — in both old- and new-file numbering. | After partial expansion the ranges shrink accordingly. | unit (diffNav.test.ts) |
| STOP-8 | A trailing gap stop exists iff the last hunk ends before the end of the new file, sized to the remaining line count. | | unit (diffNav.test.ts) |
| STOP-9 | Line counting ignores a single trailing newline (a file ending `"...\n"` has the same line count the diff reports). | | unit (diffNav.test.ts) |

## EXP — expansion

| ID | Behavior (MUST) | Notes | Covered by |
|----|-----------------|-------|------------|
| EXP-1 | Expanding a bar by N lines from an end converts exactly those N hidden lines into context line stops, in order, and shrinks the gap stop's hidden ranges to the remainder. | | unit (diffNav.test.ts) |
| EXP-2 | When the revealed counts meet or exceed the hidden size, the gap stop disappears entirely and the whole range is context line stops. | | unit (diffNav.test.ts) |
| EXP-3 | Each Enter/Space press on a bar advances the expansion by exactly one chunk (100 lines) in the bar's direction(s) — identical to what the renderer reveals for the same action. | `both` advances both ends by 100. Map consumption is exercised by the EXP-1/2 unit tests; the renderer lockstep is e2e. | planned:e2e |
| EXP-4 | A leading bar reveals from the bottom of its hidden range (adjacent to the first hunk) upward; a trailing bar reveals from the top (adjacent to the last hunk) downward. Recorded `fromEnd` on a trailing range is ignored — matching the renderer. | | unit (diffNav.test.ts) |
| EXP-5 | Shift+click on any expand control, and the "Expand all" button, reveal the bar's entire hidden range in one action. | Recorded as `Infinity`; clamping makes any over-expansion equivalent to full reveal. | unit (clamp, diffNav.test.ts) + planned:e2e |
| EXP-6 | After expanding via Enter/Space on the bar cursor: pressing `j` from the line above the expanded region lands on the **first revealed line**, and `k` from the line below lands on the **last revealed line** — never leaping past the region. | The original regression. Nav model and renderer must agree on what is revealed. | e2e (expansion.e2e.ts) |
| EXP-7 | EXP-6 holds identically when the expansion came from a mouse click on the bar's pill or expand buttons (pill = the bar's own direction(s); each button = its direction). | Clicks are handled inside the diff library; the nav model mirrors them. | planned:e2e |
| EXP-8 | Expanding a bar (any entry point) never changes the line selection. | A selection made for a comment must survive expansion. | planned:e2e |
| EXP-9 | Every expansion drops the bar cursor: the cursor reverts to the line selection so stepping continues from the reading position (EXP-6); expanding further requires landing on the (smaller) bar again. | Without this, a retained bar cursor + CUR-5 would make j skip the revealed lines above the remaining bar. Shift+click / "Expand all" covers "reveal everything now". | e2e (expansion.e2e.ts) |
| EXP-10 | j/k never lands on a bar that no longer renders (fully revealed). | Fully revealed gaps leave the stop list; a virtualization-recycled bar that still exists is a valid landing target. | planned:e2e |
| EXP-11 | Expansion state is remembered **per file (and per staged/unstaged side) for the app session**: switching away and back restores the same revealed lines, with the stop list matching. It resets when that file's diff content changes, and on relaunch. | *(Amended in review: was reset-on-switch.)* Content change invalidates the map because bar indices shift; detected via a cheap content fingerprint, so unrelated-file refreshes don't clear it. | e2e (files.e2e.ts) |

## NAV — cursor stepping

| ID | Behavior (MUST) | Notes | Covered by |
|----|-----------------|-------|------------|
| NAV-1 | `j` moves the cursor to the next stop; `k` to the previous stop. Landing on a line stop selects exactly that line on the stop's side and re-anchors there. | | planned:e2e |
| NAV-2 | j/k does not wrap: `j` on the last stop and `k` on the first stop do nothing. | | planned:e2e |
| NAV-3 | Bars are stops: landing on one highlights the bar's pill(s) and leaves the existing line selection untouched. | The bar cursor is the visible cursor while on a bar. | planned:e2e |
| NAV-4 | `]` jumps to the start of the next change block and `[` to the previous one, wrapping around the file in both directions. | | planned:e2e |
| NAV-5 | A change-block start is a change stop whose predecessor is not a change stop. | Context lines and bars between blocks separate them. | unit (diffNav.test.ts) |
| NAV-6 | Navigation keys are inert while focus is in an input, textarea, or contenteditable, and while Cmd/Ctrl/Alt is held. (Shift is meaningful: Shift+J/K.) | | planned:e2e |
| NAV-7 | Navigation keys act on the newly selected file immediately after a file switch — no click required first. | | planned:e2e |

## CUR — cursor resolution

Where a keypress decides "where am I?" before stepping.

| ID | Behavior (MUST) | Notes | Covered by |
|----|-----------------|-------|------------|
| CUR-1 | A visible bar cursor outranks the line selection: j/k steps from the bar. | | planned:e2e |
| CUR-2 | With no bar cursor, the cursor is the stop matching the selection's end **on its own side** — a deletions-side selection of old-line N never resolves to new-line N's row. | | unit (diffNav.test.ts) |
| CUR-3 | A selection end on a line currently hidden behind a bar resolves to that bar's gap stop. | E.g. after collapsing again via file-switch-and-back. | unit (diffNav.test.ts) |
| CUR-4 | A selection end matching no stop and no hidden range resolves to the nearest line stop by line distance. | Defensive fallback; keeps the cursor usable. | unit (diffNav.test.ts) |
| CUR-5 | j/k always steps **from the cursor**, even when it has been scrolled out of view — the destination row is brought into view, returning the viewport to the cursor's neighborhood. Only when no cursor exists at all (no selection and no bar cursor, e.g. a freshly opened file) does navigation begin from the first visible stop, landing **on** it. | The cursor is the source of truth; manual scrolling never relocates it. *(Amended in review: was resume-from-viewport.)* | e2e (scrolling.e2e.ts) |
| CUR-6 | ~~When an expansion pushes the bar cursor out of the viewport while the line selection is still visible, the selection wins resolution and j steps into the freshly revealed lines.~~ Superseded by EXP-9 (every expansion drops the bar cursor) + CUR-5 (the cursor is never silently abandoned). | Withdrawn with the resume-from-viewport policy. | — |

## SEL — selection

| ID | Behavior (MUST) | Notes | Covered by |
|----|-----------------|-------|------------|
| SEL-1 | Clicking a line selects exactly that line on the clicked side and sets the anchor there. | | planned:e2e |
| SEL-2 | Shift+click extends the selection from the anchor to the clicked line (anchor unchanged). | | planned:e2e |
| SEL-3 | Dragging across the code area selects the range from the pointer-down line to the line under the pointer, updating live during the drag. | | planned:e2e |
| SEL-4 | Shift+J/K moves the selection's **end** to the adjacent line stop, skipping bars, while the anchor stays fixed. Shrinking past the anchor is allowed (end may pass to the other side of it). | | planned:e2e |
| SEL-5 | Plain j/k after a multi-line selection collapses it to a single line: the stop adjacent to the selection's end. | | planned:e2e |
| SEL-6 | Escape closes the comment composer and clears the line selection. | | planned:e2e |
| SEL-7 | Making a line selection (click, drag, Shift+J/K, or j/k landing) clears any bar-cursor highlight. | | planned:e2e |
| SEL-8 | Switching files clears the selection and any open composer draft. | | planned:e2e |

## SCR — scrolling and visibility

| ID | Behavior (MUST) | Notes | Covered by |
|----|-----------------|-------|------------|
| SCR-1 | Every keyboard cursor move issues exactly one scroll request, targeting the destination row with align-nearest semantics, a 40 px margin, and instant behavior. | Observable via the `[nav] scrollTo` log: one entry per keypress. | planned:e2e |
| SCR-2 | No scroll occurs when the destination row is already fully visible with the margin — repeated j/k inside the viewport leaves scrollTop untouched until the cursor nears an edge. | | planned:e2e |
| SCR-3 | `]`/`[` to an off-screen change block lands with the cursor row inside the viewport (within margin of an edge at worst). | | planned:e2e |
| SCR-4 | Expanding a bar issues no cursor scroll, and the rows visible above the bar keep their on-screen position — revealed lines appear in place at the bar's location, never teleporting the viewport. | The renderer anchors the relayout; we must not fight it. | planned:e2e |
| SCR-5 | After the user scrolls the cursor out of view, the next j/k steps from the cursor and brings the destination row back into view (CUR-5) — manual scrolling never relocates the cursor. | *(Amended in review: was resume-from-viewport.)* | e2e (scrolling.e2e.ts) |
| SCR-6 | Every file opens scrolled to the top. | Per-file view remount. | planned:e2e |
| SCR-7 | Keyboard navigation never changes horizontal scroll. | Long-line fixture; scroll right, j/k, offset preserved. | planned:e2e |

## FILE — file and view-mode state

| ID | Behavior (MUST) | Notes | Covered by |
|----|-----------------|-------|------------|
| FILE-1 | File switch resets the cursor, anchor, and bar cursor (selection clears per SEL-8). Expansion state persists per EXP-11. | *(Amended in review: expansion no longer resets here.)* | planned:e2e |
| FILE-2 | Toggling split↔unified preserves the line selection, and the cursor resolves to the same file line in the new layout's stop list. | Stop indices differ between modes; the line must not. | planned:e2e |
| FILE-3 | For a file present in both buckets, the Unstaged/Staged toggle swaps to the other entry's contents with a fresh view (top scroll, reset nav state). | | planned:e2e |

## Appendix A — structural invariants (not automatable)

Enforced by code review; listed so they're not lost.

| ID | Invariant | Why |
|----|-----------|-----|
| STR-1 | Window-level listeners (keydown, capture-phase click, pointerdown) are registered once by `[]`-effects as **trampolines** that call through a ref reassigned every render. | Vite/react-refresh hot-swap does not re-run `[]`-effects; a directly-registered closure keeps executing last-launch code (June 2026 regressions; commits `03202f7`, `e6fd2ab`). |
| STR-2 | The diff is parsed once per file (`parseDiffFromFile`) and the same object feeds both the renderer and `buildNavStops`. | Model and pixels cannot disagree if they share one source. |
| STR-3 | The keyboard handler scrolls only through the renderer's scroll API (single call site); it never writes `scrollTop` directly. | Two scroll authorities was the root of the pre-rewrite jump bugs. |
| STR-4 | Expansion bookkeeping has a single entry point (`recordExpansion`) used by every expansion source. | Divergent bookkeeping is how mouse expansion broke while Enter worked. |

## Appendix B — fixture matrix

Fixtures live in `src/mainview/web/fixtures/` and are shared by unit tests and
e2e tests (same builders), sized around the 100-line expansion chunk and the
1-line collapse threshold.

| Fixture | Shape | Exercises |
|---------|-------|-----------|
| `basic` (default) | 5 files: modified (3 change blocks), added/untracked, deleted, renamed (+small edit), binary; one file also staged; comments: single-line, multi-line, resolved | sidebar, statuses, file switch, comments, binary placeholder |
| `gaps-small` | one file ~300 lines; leading/middle/trailing gaps all < 100 | full expansion in one press, bar removal (EXP-2/9) |
| `gaps-large` | one file ~1200 lines; leading ~150, middle ~400, trailing ~300 | partial + repeated expansion, Infinity expansion (EXP-1/3/5) |
| `edge-blocks` | change at line 1; change at EOF; blocks separated by exactly 1 and exactly 2 context lines; adjacent del-only/add-only/replace blocks | STOP-5/6/8, NAV-4/5 block boundaries |
| `pure-add-delete` | a new 120-line file + a fully deleted 80-line file | single-sided stops, unified/split parity |
| `long-file` | ~3000 lines, ~25 change blocks, some 400-char lines | SCR-* (visibility, resume, horizontal) |
| `staged-both` | same path in both buckets, different contents | FILE-3 |
