// Renders the selected file's diff using @pierre/diffs. `diffStyle` switches
// between unified and split. Clicking anywhere on a line selects it; drag /
// shift-click extend the selection; j/k move the single-line cursor and ] / [
// jump between changes. A "+" appears in the gutter to open an inline comment
// composer. Existing comments render inline as annotations at their end line.

import { type DiffLineAnnotation, MultiFileDiff, Virtualizer } from '@pierre/diffs/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationSide, FileChange } from '../../shared/types';
import { useReviewStore } from '../store';
import { CommentComposer, CommentThread } from './CommentThread';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

type AnnotationMeta =
  | {
      kind: 'comment';
      id: string;
    }
  | {
      kind: 'draft';
    };

// Verbose j/k navigation + scroll logging, to debug cursor/scroll behavior in
// the Developer Tools console (View ▸ Toggle Developer Tools). On by default;
// silence with `window.__navDebug = false` from the console.
function navLog(label: string, detail?: Record<string, unknown>): void {
  if (
    (
      globalThis as {
        __navDebug?: boolean;
      }
    ).__navDebug !== false
  ) {
    console.log(`[nav] ${label}`, detail ?? '');
  }
}

// Find the additions-side cell for `line` in the diff's open shadow DOM (falls
// back to either side / light DOM). Used to scroll the j/k cursor into view.
function findLineCell(root: HTMLElement, line: number): HTMLElement | null {
  const selector = `[data-column-number="${line}"]`;
  for (const node of root.querySelectorAll('*')) {
    const shadow = node.shadowRoot;
    if (!shadow) {
      continue;
    }
    const cell =
      shadow.querySelector<HTMLElement>(`[data-additions] ${selector}`) ?? shadow.querySelector<HTMLElement>(selector);
    if (cell) {
      return cell;
    }
  }
  return root.querySelector<HTMLElement>(selector);
}

// First additions-side line number currently rendered (≈ top of the viewport),
// used as the starting cursor when nothing is selected yet.
function firstRenderedLine(root: HTMLElement): number | null {
  for (const node of root.querySelectorAll('*')) {
    const shadow = node.shadowRoot;
    if (!shadow) {
      continue;
    }
    // Prefer the additions column (split); fall back to any column (unified).
    const cell =
      shadow.querySelector<HTMLElement>('[data-additions] [data-column-number]') ??
      shadow.querySelector<HTMLElement>('[data-column-number]');
    if (cell?.dataset.columnNumber) {
      return Number(cell.dataset.columnNumber);
    }
  }
  return null;
}

// Scroll the diff's vertical scroller to reveal `el`, WITHOUT touching the
// horizontal scroll position — so indentation/tabs the user scrolled to stay
// put. The margin keeps a little context past the edge, which also keeps the
// virtualizer rendering ahead so up/down navigation doesn't stick at the window
// edge (e.g. when scrolling up from the bottom of a long file).
function scrollRowIntoView(root: HTMLElement, el: HTMLElement): void {
  const scroller = root.querySelector<HTMLElement>('.overflow-auto');
  if (!scroller) {
    return;
  }
  const elRect = el.getBoundingClientRect();
  const viewRect = scroller.getBoundingClientRect();
  const margin = 40;
  const before = scroller.scrollTop;
  if (elRect.top < viewRect.top + margin) {
    scroller.scrollTop -= viewRect.top + margin - elRect.top;
  } else if (elRect.bottom > viewRect.bottom - margin) {
    scroller.scrollTop += elRect.bottom - viewRect.bottom + margin;
  }
  navLog('scrollRowIntoView', {
    elTop: Math.round(elRect.top),
    elBottom: Math.round(elRect.bottom),
    viewTop: Math.round(viewRect.top),
    viewBottom: Math.round(viewRect.bottom),
    scrollTopBefore: Math.round(before),
    scrollTopAfter: Math.round(scroller.scrollTop),
    moved: Math.round(scroller.scrollTop - before),
  });
}

// Scroll a cursor line into view; if it isn't rendered (collapsed/virtualized),
// nudge the viewport in the move direction so it scrolls toward it.
function scrollLineIntoView(root: HTMLElement, line: number, direction: number): void {
  const cell = findLineCell(root, line);
  if (cell) {
    scrollRowIntoView(root, cell);
  } else {
    root.querySelector<HTMLElement>('.overflow-auto')?.scrollBy({
      top: direction * 90,
      behavior: 'smooth',
    });
  }
}

// The diff renders into an open shadow root; find the one holding the rows.
function diffShadowRoot(root: HTMLElement): ShadowRoot | null {
  for (const node of root.querySelectorAll('*')) {
    const shadow = node.shadowRoot;
    if (shadow?.querySelector('[data-column-number], [data-separator]')) {
      return shadow;
    }
  }
  return null;
}

// One navigable stop: a code line or a collapsed-context bar. A visual row is
// identified by BOTH its new-side (addLine) and old-side (delLine) file lines —
// a context/modified row has both — so the keyboard cursor can be re-located no
// matter which side a selection or click came from. (Identifying a row by a
// single file line number is ambiguous: new-file line N and old-file line N are
// different rows, which made the cursor jump to the top of the file.)
interface VisualRow {
  /** Element to scroll into view (the additions cell when present). */
  el: HTMLElement;
  /** New-file line number, if this row has an additions/context cell. */
  addLine: number | null;
  /** Old-file line number, if this row has a deletions/context cell. */
  delLine: number | null;
  /** expand-index when this row is a collapsed bar (then add/delLine are null). */
  sep: string | null;
}

interface RowAcc {
  top: number;
  addEl: HTMLElement | null;
  delEl: HTMLElement | null;
  addLine: number | null;
  delLine: number | null;
  sepEl: HTMLElement | null;
  sep: string | null;
}

// Navigable stops in true on-screen order: every rendered code line plus the
// collapsed bars, ordered by vertical position so j/k step exactly what the eye
// sees. Split renders two columns (additions / deletions) and unified one;
// keying by rounded top collapses a split row's two cells into one stop while
// recording both file-line numbers.
function visualRows(shadow: ShadowRoot): VisualRow[] {
  const byTop = new Map<number, RowAcc>();
  const at = (top: number): RowAcc => {
    let acc = byTop.get(top);
    if (!acc) {
      acc = {
        top,
        addEl: null,
        delEl: null,
        addLine: null,
        delLine: null,
        sepEl: null,
        sep: null,
      };
      byTop.set(top, acc);
    }
    return acc;
  };

  for (const el of shadow.querySelectorAll<HTMLElement>('[data-line]')) {
    const lineAttr = el.getAttribute('data-line');
    const type = el.getAttribute('data-line-type') ?? '';
    if (lineAttr == null || !(type.startsWith('change') || type.startsWith('context'))) {
      continue;
    }
    const acc = at(Math.round(el.getBoundingClientRect().top));
    if (type === 'change-deletion' || el.closest('[data-deletions]')) {
      acc.delLine ??= Number(lineAttr);
      acc.delEl ??= el;
    } else {
      acc.addLine ??= Number(lineAttr);
      acc.addEl ??= el;
    }
  }

  for (const el of shadow.querySelectorAll<HTMLElement>('[data-separator][data-expand-index]')) {
    const acc = at(Math.round(el.getBoundingClientRect().top));
    if (acc.addEl == null && acc.delEl == null) {
      acc.sepEl ??= el;
      acc.sep ??= el.getAttribute('data-expand-index');
    }
  }

  return Array.from(byTop.values())
    .sort((a, b) => a.top - b.top)
    .map((acc) => ({
      el: (acc.addEl ?? acc.delEl ?? acc.sepEl) as HTMLElement,
      addLine: acc.addLine,
      delLine: acc.delLine,
      sep: acc.sep,
    }));
}

// Whether `row` is the one the cursor (a selection on `end`/`endSide`) sits on,
// matched against the matching side's file line.
function rowHoldsCursor(row: VisualRow, end: number, endSide: AnnotationSide): boolean {
  return row.sep == null && (endSide === 'deletions' ? row.delLine === end : row.addLine === end);
}

// The rendered cell for a given file line on a given side. Scoped to the right
// column in split (and disambiguated by line type in unified) so old-file line N
// and new-file line N don't collide.
function findCursorCell(shadow: ShadowRoot, line: number, side: AnnotationSide): HTMLElement | null {
  const scope =
    side === 'deletions'
      ? (shadow.querySelector('[data-deletions]') ?? shadow)
      : (shadow.querySelector('[data-additions]') ?? shadow);
  for (const cell of scope.querySelectorAll<HTMLElement>(`[data-line="${line}"]`)) {
    const type = cell.getAttribute('data-line-type') ?? '';
    const isDel = type === 'change-deletion' || cell.closest('[data-deletions]') != null;
    if ((side === 'deletions') === isDel) {
      return cell;
    }
  }
  return null;
}

// Whether a line cell belongs to a change (addition/deletion) vs context. The
// `data-line-type` attribute lives on the row's cells; check the cell, its
// nearest ancestor with the attribute, then any sibling cell in the same row.
function isChangeCell(cell: HTMLElement): boolean {
  const direct = cell.getAttribute('data-line-type');
  if (direct) {
    return direct.startsWith('change');
  }
  const near = cell.closest('[data-line-type]') ?? cell.parentElement?.querySelector('[data-line-type]') ?? null;
  return (near?.getAttribute('data-line-type') ?? '').startsWith('change');
}

// New-side line numbers that begin each change block ("hunk"), top-to-bottom.
// A block is a contiguous run of change lines; a context line or a collapsed
// separator ends it. Used by ] / [ to jump between changes. DOM-based, so it
// covers the rendered hunks (changed lines are always rendered; only unchanged
// context collapses).
function changeBlockStarts(shadow: ShadowRoot): number[] {
  const scope = shadow.querySelector('[data-additions]') ?? shadow;
  const stops = Array.from(scope.querySelectorAll<HTMLElement>('[data-column-number], [data-separator]'));
  const starts: number[] = [];
  let prevWasChange = false;
  for (const el of stops) {
    if (el.hasAttribute('data-separator')) {
      prevWasChange = false;
      continue;
    }
    const isChange = isChangeCell(el);
    if (isChange && !prevWasChange) {
      const line = Number(el.getAttribute('data-column-number'));
      if (Number.isFinite(line)) {
        starts.push(line);
      }
    }
    prevWasChange = isChange;
  }
  return starts;
}

// Highlight every separator element for one collapsed region (split view renders
// it across the additions + deletions columns, so highlight them all).
function highlightSeparator(shadow: ShadowRoot, expandIndex: string): void {
  for (const el of shadow.querySelectorAll<HTMLElement>(`[data-separator][data-expand-index="${expandIndex}"]`)) {
    el.setAttribute('data-nav-cursor', '');
    el.style.outline = '2px solid #3b82f6';
    el.style.outlineOffset = '-2px';
    el.style.background = 'rgba(59, 130, 246, 0.16)';
  }
}

// Remove the keyboard-cursor highlight from any collapsed-context bar.
function clearSeparatorCursor(shadow: ShadowRoot): void {
  for (const el of shadow.querySelectorAll<HTMLElement>('[data-nav-cursor]')) {
    el.removeAttribute('data-nav-cursor');
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.background = '';
  }
}

export function DiffPane() {
  const model = useReviewStore((state) => state.model);
  const selectedPath = useReviewStore((state) => state.selectedPath);
  const diffStyle = useReviewStore((state) => state.diffStyle);
  const ignoreWhitespace = useReviewStore((state) => state.ignoreWhitespace);
  const selectedLines = useReviewStore((state) => state.selectedLines);
  const setSelectedLines = useReviewStore((state) => state.setSelectedLines);
  const draft = useReviewStore((state) => state.draft);
  const commentOnRange = useReviewStore((state) => state.commentOnRange);
  const closeDraft = useReviewStore((state) => state.closeDraft);
  const comments = useReviewStore((state) => state.comments);
  const approve = useReviewStore((state) => state.approve);
  const unapprove = useReviewStore((state) => state.unapprove);
  const working = useReviewStore((state) => state.compare.kind === 'working');
  const [side, setSide] = useState<'new' | 'approved'>('new');
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<FileChange | null>(null);
  // Fixed end of the selection (set on click / cursor move); shift-click and
  // Shift+J/K extend from here.
  const anchorRef = useRef<{
    line: number;
    side: AnnotationSide;
  } | null>(null);
  // Expand-index of the collapsed bar the keyboard cursor is on (null = on a line).
  const sepCursorRef = useRef<string | null>(null);
  // Drag-to-select on the code area (the lib's own line-drag is gutter-only):
  // pointerdown on a line starts a drag, onLineEnter extends it.
  const draggingRef = useRef(false);
  const hoveredLineRef = useRef<{
    line: number;
    side: AnnotationSide;
  } | null>(null);

  // A file edited again after approval appears in both buckets; let the user
  // toggle between the staged ("approved") side and the unstaged ("new") side.
  const unstagedEntry = useMemo(
    () => model?.unreviewed.find((entry) => entry.path === selectedPath) ?? null,
    [
      model,
      selectedPath,
    ],
  );
  const stagedEntry = useMemo(
    () => model?.reviewed.find((entry) => entry.path === selectedPath) ?? null,
    [
      model,
      selectedPath,
    ],
  );
  const hasBoth = unstagedEntry !== null && stagedEntry !== null;
  const effectiveSide = side === 'approved' && stagedEntry ? 'approved' : 'new';
  const file = effectiveSide === 'approved' ? stagedEntry : (unstagedEntry ?? stagedEntry);
  fileRef.current = file;

  const fileComments = useMemo(
    () => comments.filter((comment) => comment.path === file?.path),
    [
      comments,
      file,
    ],
  );

  // Keyboard navigation in the diff:
  //   j/k        move a single-line cursor; collapsed "N unmodified lines" bars
  //              are stops too (outlined), and Enter/Space expands them.
  //   Shift+J/K  grow/shrink the line selection from the anchor.
  //   ] / [      jump to the next / previous change, skipping context.
  // (event.code is layout- and shift-independent, so Shift+J still reports KeyJ.)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const root = containerRef.current;
      const currentFile = fileRef.current;
      if (!root || !currentFile) {
        return;
      }
      const shadow = diffShadowRoot(root);
      const store = useReviewStore.getState();

      // Enter / Space expands the collapsed bar the cursor is on.
      if ((event.key === 'Enter' || event.code === 'Space') && sepCursorRef.current != null && shadow) {
        const sep = shadow.querySelector<HTMLElement>(`[data-separator][data-expand-index="${sepCursorRef.current}"]`);
        const button =
          sep?.querySelector<HTMLElement>('[data-expand-down],[data-expand-both]') ??
          sep?.querySelector<HTMLElement>('[data-expand-button],[data-unmodified-lines]');
        if (button) {
          event.preventDefault();
          button.click();
        }
        return;
      }

      // ] / [ — jump to the next / previous change ("hunk"), skipping context
      // lines and collapsed bars. (File nav is Cmd+Shift+] / [ on the menu, so
      // the bare brackets are free.)
      if (event.key === ']' || event.key === '[') {
        event.preventDefault();
        const dir = event.key === ']' ? 1 : -1;
        const starts = shadow ? changeBlockStarts(shadow) : [];
        if (shadow && starts.length > 0) {
          const cursor = store.selectedLines?.end ?? firstRenderedLine(root) ?? 0;
          const target =
            dir > 0
              ? (starts.find((line) => line > cursor) ?? starts[0])
              : (starts.filter((line) => line < cursor).at(-1) ?? starts[starts.length - 1]);
          clearSeparatorCursor(shadow);
          sepCursorRef.current = null;
          anchorRef.current = {
            line: target,
            side: 'additions',
          };
          store.setSelectedLines({
            start: target,
            end: target,
            side: 'additions',
            endSide: 'additions',
          });
          scrollLineIntoView(root, target, dir);
        }
        return;
      }

      if (event.code !== 'KeyJ' && event.code !== 'KeyK') {
        return;
      }
      event.preventDefault();
      const direction = event.code === 'KeyJ' ? 1 : -1;
      const maxLine = Math.max(1, currentFile.newContents.split('\n').length);
      const selection = store.selectedLines;

      // Shift+J/K: grow/shrink the line selection from the anchor.
      if (event.shiftKey) {
        const start = selection?.start ?? firstRenderedLine(root) ?? 1;
        const side = selection?.side ?? 'additions';
        const end = selection ? Math.min(maxLine, Math.max(1, selection.end + direction)) : start;
        anchorRef.current = {
          line: start,
          side,
        };
        store.setSelectedLines({
          start,
          side,
          end,
          endSide: side,
        });
        scrollLineIntoView(root, end, direction);
        return;
      }

      // Plain j/k: step through visual rows (code lines + collapsed bars) in
      // on-screen order, selecting each on its own side so the cursor tracks
      // what's visible — no jumping over deletion rows, and correct in unified.
      const rows = shadow ? visualRows(shadow) : [];
      if (rows.length === 0) {
        const line = Math.max(1, Math.min(maxLine, (selection?.end ?? firstRenderedLine(root) ?? 1) + direction));
        store.setSelectedLines({
          start: line,
          end: line,
          side: 'additions',
          endSide: 'additions',
        });
        scrollLineIntoView(root, line, direction);
        return;
      }
      // Locate the current cursor among the rows. Match against whichever side
      // the selection is on — a context / modified row carries both file lines,
      // so a deletions-side selection still resolves to its visual row instead
      // of falling through to a same-numbered row near the top.
      let current = -1;
      if (selection) {
        const endSide = selection.endSide ?? selection.side ?? 'additions';
        current = rows.findIndex((row) => rowHoldsCursor(row, selection.end, endSide));
      } else if (sepCursorRef.current != null) {
        current = rows.findIndex((row) => row.sep === sepCursorRef.current);
      }
      navLog(event.code === 'KeyJ' ? 'j (down)' : 'k (up)', {
        rows: rows.length,
        current,
        foundVia: selection
          ? `selection ${selection.end}/${selection.endSide ?? selection.side}`
          : sepCursorRef.current != null
            ? `sep ${sepCursorRef.current}`
            : 'none',
      });
      // If the cursor row has been scrolled out of view (e.g. the user
      // wheel-scrolled away), resume from the viewport rather than snapping back
      // to the off-screen cursor.
      if (current !== -1) {
        const rect = rows[current].el.getBoundingClientRect();
        const view = root.querySelector('.overflow-auto')?.getBoundingClientRect();
        if (view && (rect.bottom <= view.top || rect.top >= view.bottom)) {
          navLog('cursor off-screen → resume from viewport', {
            cursorTop: Math.round(rect.top),
            viewTop: Math.round(view.top),
            viewBottom: Math.round(view.bottom),
          });
          current = -1;
        }
      }
      if (current === -1) {
        // Cursor not on a rendered row (e.g. clicked elsewhere): resume from the
        // first row visible in the viewport — never the top of the file.
        const viewportTop = root.querySelector('.overflow-auto')?.getBoundingClientRect().top ?? 0;
        const firstVisible = rows.findIndex((row) => Math.round(row.el.getBoundingClientRect().top) >= viewportTop - 1);
        navLog('resume from viewport', {
          firstVisible,
        });
        if (firstVisible === -1) {
          return;
        }
        current = firstVisible - direction; // so current + direction lands on it
      }
      const nextIndex = Math.min(rows.length - 1, Math.max(0, current + direction));
      const next = rows[nextIndex];
      navLog('→ target', {
        fromIndex: current,
        toIndex: nextIndex,
        addLine: next.addLine,
        delLine: next.delLine,
        sep: next.sep,
        clamped: nextIndex === current,
      });
      if (shadow) {
        clearSeparatorCursor(shadow);
      }
      if (next.sep != null && shadow) {
        sepCursorRef.current = next.sep;
        highlightSeparator(shadow, next.sep);
        store.setSelectedLines(null);
      } else {
        // Select on the row's primary side: additions when it has a new-side
        // cell, else deletions (a pure-deletion row).
        const side: AnnotationSide = next.addLine != null ? 'additions' : 'deletions';
        const line = next.addLine ?? next.delLine;
        if (line != null) {
          sepCursorRef.current = null;
          anchorRef.current = {
            line,
            side,
          };
          store.setSelectedLines({
            start: line,
            end: line,
            side,
            endSide: side,
          });
        }
      }
      scrollRowIntoView(root, next.el);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // When a line gets selected (click, drag, Shift+J/K), drop any bar highlight.
  useEffect(() => {
    if (selectedLines) {
      const root = containerRef.current;
      const shadow = root ? diffShadowRoot(root) : null;
      if (shadow) {
        clearSeparatorCursor(shadow);
      }
      sepCursorRef.current = null;
    }
  }, [
    selectedLines,
  ]);

  // Keep the cursor row vertically in view after the selection changes. The diff
  // lib mis-scrolls (jumps toward the top) when a deletions-side selection is
  // applied in split view; re-centering on the real cursor row — after the lib's
  // own scroll, since parent layout effects run after the child's — corrects it.
  // Vertical-only (horizontal stays put) and a no-op when the row is already in
  // view, so clicks and drag-select aren't disturbed.
  useLayoutEffect(() => {
    if (!selectedLines) {
      return;
    }
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const shadow = diffShadowRoot(root);
    if (!shadow) {
      return;
    }
    const endSide = selectedLines.endSide ?? selectedLines.side ?? 'additions';
    const cell = findCursorCell(shadow, selectedLines.end, endSide);
    if (cell) {
      scrollRowIntoView(root, cell);
    }
  }, [
    selectedLines,
  ]);

  // Pointer-drag selection on the code area. The anchor is whatever line the
  // pointer is over at mousedown (tracked via onLineEnter); onLineEnter then
  // extends to the line under the pointer while dragging.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const root = containerRef.current;
      const hovered = hoveredLineRef.current;
      if (!root || !hovered || !root.contains(event.target as Node)) {
        return;
      }
      draggingRef.current = true;
      const anchor = anchorRef.current;
      if (event.shiftKey && anchor) {
        // Shift+down extends from the existing anchor (and a shift-drag keeps it).
        useReviewStore.getState().setSelectedLines({
          start: anchor.line,
          side: anchor.side,
          end: hovered.line,
          endSide: hovered.side,
        });
      } else {
        anchorRef.current = hovered;
        useReviewStore.getState().setSelectedLines({
          start: hovered.line,
          end: hovered.line,
          side: hovered.side,
          endSide: hovered.side,
        });
      }
    };
    const onPointerUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to review
      </div>
    );
  }

  // Anchor annotations (and the draft composer) at the end of the range, so a
  // multi-line comment appears just below the block it covers.
  const annotations: DiffLineAnnotation<AnnotationMeta>[] = [
    ...fileComments.map((comment) => ({
      side: comment.endSide ?? comment.side,
      lineNumber: comment.endLine ?? comment.line,
      metadata: {
        kind: 'comment' as const,
        id: comment.id,
      },
    })),
    ...(draft && draft.path === file.path
      ? [
          {
            side: draft.endSide ?? draft.side,
            lineNumber: draft.endLine ?? draft.line,
            metadata: {
              kind: 'draft' as const,
            },
          },
        ]
      : []),
  ];

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col"
    >
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3 text-xs">
        <span className="truncate text-foreground">{file.path}</span>
        {file.binary ? (
          <span className="shrink-0 font-mono text-muted-foreground">binary</span>
        ) : (
          <span className="shrink-0 font-mono text-muted-foreground">
            <span className="text-emerald-500">+{file.additions}</span>{' '}
            <span className="text-red-500">−{file.deletions}</span>
          </span>
        )}
        {hasBoth ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={effectiveSide}
            onValueChange={(value) => {
              if (value === 'new' || value === 'approved') {
                setSide(value);
              }
            }}
          >
            <ToggleGroupItem value="new">Unstaged</ToggleGroupItem>
            <ToggleGroupItem value="approved">Staged</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        {working ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() =>
              file.staged
                ? unapprove([
                    file.path,
                  ])
                : approve([
                    file.path,
                  ])
            }
          >
            {file.staged ? 'Unapprove' : 'Approve'}
          </Button>
        ) : null}
      </div>
      {file.binary ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
          Binary file — diff not shown
        </div>
      ) : (
        <Virtualizer className="min-h-0 flex-1 overflow-auto bg-background select-none">
          <MultiFileDiff<AnnotationMeta>
            key={`${file.path}:${file.staged ? 'staged' : 'unstaged'}`}
            oldFile={{
              name: file.oldPath ?? file.path,
              contents: file.oldContents,
            }}
            newFile={{
              name: file.path,
              contents: file.newContents,
            }}
            options={{
              diffStyle,
              parseDiffOptions: {
                ignoreWhitespace,
              },
              theme: {
                dark: 'pierre-dark',
                light: 'pierre-light',
              },
              themeType: 'dark',
              enableLineSelection: true,
              controlledSelection: true,
              lineHoverHighlight: 'both',
              enableGutterUtility: true,
              // Drag-select (lib) feeds our selection; record the anchor so a
              // later shift-click / Shift+J/K extends from the drag's start.
              onLineSelectionChange: (range) => setSelectedLines(range),
              onLineSelected: (range) => {
                setSelectedLines(range);
                if (range) {
                  anchorRef.current = {
                    line: range.start,
                    side: (range.side ?? 'additions') as AnnotationSide,
                  };
                }
              },
              // Click selects just that line; shift-click extends from the anchor.
              onLineClick: (props) => {
                const anchor = anchorRef.current;
                if (props.event.shiftKey && anchor) {
                  setSelectedLines({
                    start: anchor.line,
                    side: anchor.side,
                    end: props.lineNumber,
                    endSide: props.annotationSide,
                  });
                } else {
                  anchorRef.current = {
                    line: props.lineNumber,
                    side: props.annotationSide,
                  };
                  setSelectedLines({
                    start: props.lineNumber,
                    end: props.lineNumber,
                    side: props.annotationSide,
                    endSide: props.annotationSide,
                  });
                }
              },
              // Track the hovered line (anchor for a pointer drag); while
              // dragging, extend the selection to the line under the pointer.
              onLineEnter: (props) => {
                hoveredLineRef.current = {
                  line: props.lineNumber,
                  side: props.annotationSide,
                };
                if (draggingRef.current && anchorRef.current) {
                  setSelectedLines({
                    start: anchorRef.current.line,
                    side: anchorRef.current.side,
                    end: props.lineNumber,
                    endSide: props.annotationSide,
                  });
                }
              },
              onLineLeave: () => {
                hoveredLineRef.current = null;
              },
              // The gutter "+" gives the clicked line. If a multi-line selection
              // is active and covers that line, comment on the whole selection.
              onGutterUtilityClick: (range) => {
                const selection = useReviewStore.getState().selectedLines;
                if (selection && selection.end !== selection.start) {
                  const lo = Math.min(selection.start, selection.end);
                  const hi = Math.max(selection.start, selection.end);
                  if (range.start >= lo && range.start <= hi) {
                    commentOnRange(file.path, selection);
                    return;
                  }
                }
                commentOnRange(file.path, range);
              },
            }}
            selectedLines={selectedLines}
            lineAnnotations={annotations}
            renderAnnotation={(annotation) => {
              const meta = annotation.metadata;
              if (meta.kind === 'draft') {
                return draft ? (
                  <CommentComposer
                    draft={draft}
                    onClose={closeDraft}
                  />
                ) : null;
              }
              const comment = fileComments.find((entry) => entry.id === meta.id);
              return comment ? <CommentThread comment={comment} /> : null;
            }}
            disableWorkerPool
          />
        </Virtualizer>
      )}
    </div>
  );
}
