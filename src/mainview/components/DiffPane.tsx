// Renders the selected file's diff using @pierre/diffs. `diffStyle` switches
// between unified and split. Clicking anywhere on a line selects it; drag /
// shift-click extend the selection; j/k move the single-line cursor and ] / [
// jump between changes. A "+" appears in the gutter to open an inline comment
// composer. Existing comments render inline as annotations at their end line.
//
// Keyboard navigation works on a precomputed stop list derived from the SAME
// parsed diff the renderer draws (see diffNav.ts) — the DOM is only consulted
// to ask "what's visible?" and to scroll. parseDiffFromFile is called once here
// and handed to <FileDiff>, so the model and the pixels can't disagree.

import { parseDiffFromFile } from '@pierre/diffs';
import { type DiffLineAnnotation, FileDiff, Virtualizer } from '@pierre/diffs/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationSide } from '../../shared/types';
import { useReviewStore } from '../store';
import { CommentComposer, CommentThread } from './CommentThread';
import {
  buildNavStops,
  countLines,
  gapStopIndex,
  type NavStop,
  nearestLineStop,
  nextChangeIndex,
  stopIndexForSelection,
} from './diffNav';
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

// The diff renders into an open shadow root; find the one holding the rows.
function diffShadowRoot(root: HTMLElement): ShadowRoot | null {
  for (const node of root.querySelectorAll('*')) {
    const shadow = node.shadowRoot;
    if (shadow?.querySelector('[data-line], [data-separator]')) {
      return shadow;
    }
  }
  return null;
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

// A collapsed-context bar's rendered element (null once fully expanded away).
function findSeparator(shadow: ShadowRoot, expandIndex: number): HTMLElement | null {
  return shadow.querySelector<HTMLElement>(`[data-separator][data-expand-index="${expandIndex}"]`);
}

// The rendered element a stop corresponds to, if it is currently rendered.
function stopElement(shadow: ShadowRoot, stop: NavStop): HTMLElement | null {
  return stop.kind === 'gap' ? findSeparator(shadow, stop.expandIndex) : findCursorCell(shadow, stop.line, stop.side);
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
  if (scroller.scrollTop !== before) {
    navLog('scroll', {
      moved: Math.round(scroller.scrollTop - before),
      scrollTop: Math.round(scroller.scrollTop),
    });
  }
}

// Scroll `getEl()` into view now and re-assert it for a few frames. The diff
// lib can scroll asynchronously after a state change (scroll restoration on
// re-render, occasionally to the wrong place); since scrollRowIntoView is a
// no-op when the row is already in view, the hold only ever corrects drift.
function holdRowInView(root: HTMLElement, getEl: () => HTMLElement | null): void {
  let frames = 0;
  const assert = () => {
    const el = getEl();
    if (el) {
      scrollRowIntoView(root, el);
    }
    frames++;
    if (frames < 4) {
      requestAnimationFrame(assert);
    }
  };
  assert();
}

// Whether a stop's rendered element overlaps the scroller's viewport.
function stopInViewport(root: HTMLElement, shadow: ShadowRoot, stop: NavStop): boolean {
  const el = stopElement(shadow, stop);
  if (!el) {
    return false;
  }
  const view = root.querySelector('.overflow-auto')?.getBoundingClientRect();
  if (!view) {
    return true;
  }
  const rect = el.getBoundingClientRect();
  return rect.bottom > view.top && rect.top < view.bottom;
}

// The stop whose rendered cell sits nearest the top of the viewport — where
// navigation resumes when the cursor is lost or was scrolled away. (With
// virtualization, "what is on screen" is genuinely a DOM question.)
function firstVisibleStopIndex(root: HTMLElement, shadow: ShadowRoot, stops: NavStop[]): number {
  const view = root.querySelector('.overflow-auto')?.getBoundingClientRect();
  if (!view) {
    return stops.length > 0 ? 0 : -1;
  }
  let bestTop = Number.POSITIVE_INFINITY;
  let best: {
    line: number;
    side: AnnotationSide;
  } | null = null;
  for (const cell of shadow.querySelectorAll<HTMLElement>('[data-line]')) {
    const rect = cell.getBoundingClientRect();
    if (rect.bottom <= view.top || rect.top >= view.bottom || rect.top >= bestTop) {
      continue;
    }
    const line = Number(cell.getAttribute('data-line'));
    if (!Number.isFinite(line)) {
      continue;
    }
    const type = cell.getAttribute('data-line-type') ?? '';
    const isDel = type === 'change-deletion' || cell.closest('[data-deletions]') != null;
    bestTop = rect.top;
    best = {
      line,
      side: isDel ? 'deletions' : 'additions',
    };
  }
  if (!best) {
    return -1;
  }
  const exact = stopIndexForSelection(stops, best.line, best.side);
  return exact !== -1 ? exact : nearestLineStop(stops, best.line);
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

  const fileComments = useMemo(
    () => comments.filter((comment) => comment.path === file?.path),
    [
      comments,
      file,
    ],
  );

  // Parse the diff ONCE — the renderer (<FileDiff>) and the keyboard model both
  // consume this object, so they can never disagree about hunks or lines.
  const oldName = file?.oldPath ?? file?.path ?? '';
  const newName = file?.path ?? '';
  const oldContents = file?.oldContents ?? '';
  const newContents = file?.newContents ?? '';
  const binary = file?.binary ?? false;
  const fileDiff = useMemo(
    () =>
      !file || binary
        ? null
        : parseDiffFromFile(
            {
              name: oldName,
              contents: oldContents,
            },
            {
              name: newName,
              contents: newContents,
            },
            {
              ignoreWhitespace,
            },
          ),
    [
      file,
      binary,
      oldName,
      newName,
      oldContents,
      newContents,
      ignoreWhitespace,
    ],
  );

  // The keyboard's stop list for the current view mode (see diffNav.ts), kept
  // in a ref so the []-deps keydown listener always reads the current one.
  const navStops = useMemo(
    () => (fileDiff ? buildNavStops(fileDiff, diffStyle, countLines(newContents)) : []),
    [
      fileDiff,
      diffStyle,
      newContents,
    ],
  );
  const navStopsRef = useRef<NavStop[]>([]);
  navStopsRef.current = navStops;

  // Keyboard navigation in the diff:
  //   j/k        move the cursor one stop; collapsed "N unmodified lines" bars
  //              are stops too (outlined), and Enter/Space expands them.
  //   Shift+J/K  grow/shrink the line selection from the anchor.
  //   ] / [      jump to the next / previous change block, skipping context.
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
      const stops = navStopsRef.current;
      if (!root || stops.length === 0) {
        return;
      }
      const shadow = diffShadowRoot(root);
      if (!shadow) {
        return;
      }
      const store = useReviewStore.getState();

      // Enter / Space expands the collapsed bar the cursor is on.
      if ((event.key === 'Enter' || event.code === 'Space') && sepCursorRef.current != null) {
        const sep = findSeparator(shadow, Number(sepCursorRef.current));
        const button =
          sep?.querySelector<HTMLElement>('[data-expand-down],[data-expand-both]') ??
          sep?.querySelector<HTMLElement>('[data-expand-button],[data-unmodified-lines]');
        if (button) {
          event.preventDefault();
          button.click();
        }
        return;
      }

      const isBracket = event.key === ']' || event.key === '[';
      const isJK = event.code === 'KeyJ' || event.code === 'KeyK';
      if (!isBracket && !isJK) {
        return;
      }
      event.preventDefault();
      const direction: 1 | -1 = event.key === ']' || event.code === 'KeyJ' ? 1 : -1;

      // Land the cursor on a stop: update selection / bar highlight + scroll.
      // Landing on a bar deliberately does NOT touch the line selection — the
      // selectedLines=null re-render made the diff lib mis-restore its scroll
      // position (the observed jump). The bar highlight alone is the cursor;
      // sepCursorRef takes precedence when resolving it below.
      const applyStop = (index: number) => {
        const stop = stops[index];
        clearSeparatorCursor(shadow);
        if (stop.kind === 'gap') {
          sepCursorRef.current = String(stop.expandIndex);
          highlightSeparator(shadow, sepCursorRef.current);
        } else {
          sepCursorRef.current = null;
          anchorRef.current = {
            line: stop.line,
            side: stop.side,
          };
          store.setSelectedLines({
            start: stop.line,
            end: stop.line,
            side: stop.side,
            endSide: stop.side,
          });
        }
        // Scroll now, and re-assert for a few frames: the lib can scroll
        // asynchronously after our handler (scroll restoration on re-render);
        // the hold is idempotent and vertical-only, so it only corrects drift.
        holdRowInView(root, () => stopElement(shadow, stop));
      };

      // Where is the cursor? The highlighted bar when the cursor is on one
      // (it outranks the still-present line selection), else the selection's
      // end matched on its own side. If it's unknown or was scrolled out of
      // view, resume from the first visible row instead of yanking the view.
      const selection = store.selectedLines;
      let cursor = -1;
      if (sepCursorRef.current != null) {
        cursor = gapStopIndex(stops, Number(sepCursorRef.current));
      }
      if (cursor === -1 && selection) {
        const endSide = (selection.endSide ?? selection.side ?? 'additions') as AnnotationSide;
        cursor = stopIndexForSelection(stops, selection.end, endSide);
        if (cursor === -1) {
          cursor = nearestLineStop(stops, selection.end);
        }
      }
      if (cursor !== -1 && !stopInViewport(root, shadow, stops[cursor])) {
        navLog('cursor off-screen, resuming from viewport');
        cursor = -1;
      }
      if (cursor === -1) {
        const visible = firstVisibleStopIndex(root, shadow, stops);
        if (visible === -1) {
          return;
        }
        // Step "onto" the visible row rather than past it.
        cursor = visible - direction;
      }

      // ] / [ — jump to the start of the next / previous change block.
      if (isBracket) {
        const targetIndex = nextChangeIndex(stops, cursor, direction);
        navLog(event.key, {
          from: cursor,
          to: targetIndex,
        });
        if (targetIndex !== -1) {
          applyStop(targetIndex);
        }
        return;
      }

      // Shift+J/K — move the selection's END to the adjacent line stop
      // (skipping bars) while the anchor stays put.
      if (event.shiftKey) {
        let endIndex = cursor;
        do {
          endIndex += direction;
        } while (stops[endIndex] && stops[endIndex].kind !== 'line');
        const endStop = stops[endIndex];
        if (endStop?.kind !== 'line') {
          return;
        }
        const anchor = anchorRef.current ?? {
          line: endStop.line,
          side: endStop.side,
        };
        anchorRef.current = anchor;
        store.setSelectedLines({
          start: anchor.line,
          side: anchor.side,
          end: endStop.line,
          endSide: endStop.side,
        });
        holdRowInView(root, () => findCursorCell(shadow, endStop.line, endStop.side));
        return;
      }

      // Plain j/k — step to the adjacent stop. A bar that was expanded away
      // (its element no longer renders) is skipped.
      let next = cursor + direction;
      while (stops[next] && stops[next].kind === 'gap' && stopElement(shadow, stops[next]) == null) {
        next += direction;
      }
      if (next < 0 || next >= stops.length) {
        return;
      }
      navLog(direction > 0 ? 'j' : 'k', {
        from: cursor,
        to: next,
        stop: stops[next],
      });
      applyStop(next);
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
    holdRowInView(root, () => findCursorCell(shadow, selectedLines.end, endSide));
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
      {file.binary || !fileDiff ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
          Binary file — diff not shown
        </div>
      ) : (
        <Virtualizer className="min-h-0 flex-1 overflow-auto bg-background select-none">
          <FileDiff<AnnotationMeta>
            key={`${file.path}:${file.staged ? 'staged' : 'unstaged'}`}
            fileDiff={fileDiff}
            options={{
              diffStyle,
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
