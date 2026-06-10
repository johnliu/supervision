// Renders the selected file's diff using @pierre/diffs' CodeView — the
// library's "advanced" viewer that owns the scroll container, virtualization,
// and scroll-target resolution. `diffStyle` switches between unified and
// split. Clicking anywhere on a line selects it; drag / shift-click extend the
// selection; j/k move the single-line cursor and ] / [ jump between changes.
// A "+" appears in the gutter to open an inline comment composer. Existing
// comments render inline as annotations at their end line.
//
// Architecture: ONE controlled CodeView holding ONE diff item. The item id is
// `path:staged`, and the React key remounts the view per file so every file
// opens scrolled to the top. The diff is parsed once (parseDiffFromFile) and
// shared with the keyboard model (diffNav.ts), so the renderer and the cursor
// can't disagree about rows.
//
// Scrolling goes through CodeView.scrollTo({type:'line', align:'nearest'}),
// which resolves the row's position from the LAYOUT MODEL (getLinePosition) —
// it works for rows that virtualization hasn't rendered, resolves lines hidden
// behind a collapsed bar to the bar itself, and keeps re-resolving the target
// every frame until the scroll settles. That replaces the previous
// implementation's DOM measurement + multi-frame "hold in view" loops, and it
// never touches horizontal scroll. "Which stop is visible?" is also answered
// from the model: logical scrollTop (onScroll) + viewport height +
// getLinePosition. The DOM is touched only to paint the keyboard cursor on a
// collapsed-context bar (and to check such a bar still renders).
//
// Expanding a bar (Enter) advances an `expandedHunks` map in lockstep with the
// renderer's own expansion, so buildNavStops turns the revealed lines into real
// stops and j/k steps through them instead of leaping to the next hunk. The
// scroller's background is synced to the diff's own surface (onPostRender) so a
// diff shorter than the pane doesn't show a differently-shaded void below it.

import { parseDiffFromFile } from '@pierre/diffs';
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewHandle,
  type CodeViewProps,
  type DiffLineAnnotation,
  type SelectedLineRange,
} from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationSide } from '../../shared/types';
import { useReviewStore } from '../store';
import { CommentComposer, CommentThread } from './CommentThread';
import {
  buildNavStops,
  countLines,
  type ExpansionMap,
  type GapStop,
  gapIndexForLine,
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

type DiffViewOptions = NonNullable<CodeViewProps<AnnotationMeta>['options']>;
type ViewHandle = CodeViewHandle<AnnotationMeta>;
type ViewInstance = NonNullable<ReturnType<ViewHandle['getInstance']>>;
type RenderedDiff = Extract<
  ReturnType<ViewInstance['getRenderedItems']>[number],
  {
    type: 'diff';
  }
>;
type DiffInstance = RenderedDiff['instance'];

// Pixels kept between the cursor row and the viewport edge when scrolling.
// Doubles as render-ahead: the row lands inside the virtualizer's window.
const NAV_MARGIN = 40;

// Lines revealed per Enter on a collapsed bar. Must match the count
// instance.expandHunk() applies (the lib default expansionLineCount, which we
// don't override) so our nav model and the renderer reveal the same lines.
const EXPANSION_LINE_COUNT = 100;

const THEME = {
  dark: 'pierre-dark',
  light: 'pierre-light',
} as const;

// Zero out CodeView's outer padding/gap so a stop's scroll-space position is
// exactly itemTop + getLinePosition().top (the visibility math below relies
// on it; scrollTo adds layout padding internally).
const LAYOUT = {
  paddingTop: 0,
  paddingBottom: 0,
  gap: 0,
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

// The single diff item's renderer instance, when it is mounted.
function renderedDiffInstance(view: ViewInstance | undefined | null): DiffInstance | null {
  for (const rendered of view?.getRenderedItems() ?? []) {
    if (rendered.type === 'diff') {
      return rendered.instance;
    }
  }
  return null;
}

// The shadow root holding the rendered diff rows (separator highlight only).
function diffShadow(view: ViewInstance | undefined | null): ShadowRoot | null {
  for (const rendered of view?.getRenderedItems() ?? []) {
    if (rendered.element.shadowRoot) {
      return rendered.element.shadowRoot;
    }
  }
  return null;
}

// The line number + side whose layout position stands in for a stop. For a
// gap stop that's its first hidden line: getLinePosition resolves hidden
// lines to the separator row itself. (After a partial expansion the first
// line may be revealed; it then sits at the top edge of the bar's region,
// which is still the right neighborhood for scrolling and visibility.)
function stopAnchor(stop: NavStop): {
  line: number;
  side: AnnotationSide;
} {
  return stop.kind === 'gap'
    ? {
        line: stop.addStart,
        side: 'additions',
      }
    : {
        line: stop.line,
        side: stop.side,
      };
}

// A stop's vertical bounds in scroll-space, from the layout model — defined
// whether or not virtualization currently renders the row.
function stopBounds(
  view: ViewInstance,
  itemId: string,
  stop: NavStop,
): {
  top: number;
  bottom: number;
} | null {
  const instance = renderedDiffInstance(view);
  const itemTop = view.getTopForItem(itemId);
  if (!instance || itemTop == null) {
    return null;
  }
  const anchor = stopAnchor(stop);
  const position = instance.getLinePosition(anchor.line, anchor.side);
  if (!position) {
    return null;
  }
  return {
    top: itemTop + position.top,
    bottom: itemTop + position.top + position.height,
  };
}

// Whether a stop overlaps the viewport (logical scrollTop .. + height).
function stopInViewport(
  view: ViewInstance,
  itemId: string,
  scrollTop: number,
  viewportHeight: number,
  stop: NavStop,
): boolean {
  const bounds = stopBounds(view, itemId, stop);
  if (!bounds) {
    return false;
  }
  return bounds.bottom > scrollTop && bounds.top < scrollTop + viewportHeight;
}

// The first stop intersecting the viewport — where navigation resumes when
// the cursor is unknown or was scrolled away. Stops are in visual order, so
// binary-search the first one whose bottom edge clears the viewport top.
function firstVisibleStopIndex(
  view: ViewInstance,
  itemId: string,
  scrollTop: number,
  viewportHeight: number,
  stops: NavStop[],
): number {
  let low = 0;
  let high = stops.length - 1;
  let first = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const bounds = stopBounds(view, itemId, stops[mid]);
    if (!bounds) {
      return -1;
    }
    if (bounds.bottom > scrollTop) {
      first = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  if (first === -1) {
    return -1;
  }
  const bounds = stopBounds(view, itemId, stops[first]);
  return bounds && bounds.top < scrollTop + viewportHeight ? first : -1;
}

// A collapsed-context bar's rendered element (null once expanded away — or
// when virtualization hasn't rendered it; callers only probe bars adjacent
// to the in-viewport cursor, which the render window covers).
function findSeparator(shadow: ShadowRoot, expandIndex: number): HTMLElement | null {
  return shadow.querySelector<HTMLElement>(`[data-separator][data-expand-index="${expandIndex}"]`);
}

// The separator's own box never reaches the screen: its inner pill
// ([data-separator-content]) has an opaque background and negative margins
// that cover the parent — styles set on the outer element are invisible.
// The cursor highlight is painted on the pill(s) instead.
function separatorPills(el: HTMLElement): HTMLElement[] {
  const pills = el.querySelectorAll<HTMLElement>('[data-separator-content]');
  return pills.length > 0
    ? Array.from(pills)
    : [
        el,
      ];
}

// Highlight every separator element for one collapsed region (split view renders
// it across the additions + deletions columns, so highlight them all).
function highlightSeparator(shadow: ShadowRoot, expandIndex: string): void {
  for (const el of shadow.querySelectorAll<HTMLElement>(`[data-separator][data-expand-index="${expandIndex}"]`)) {
    el.setAttribute('data-nav-cursor', '');
    for (const pill of separatorPills(el)) {
      pill.style.outline = '2px solid #3b82f6';
      pill.style.outlineOffset = '-2px';
      pill.style.background = 'rgba(59, 130, 246, 0.16)';
    }
  }
}

// Remove the keyboard-cursor highlight from any collapsed-context bar.
function clearSeparatorCursor(shadow: ShadowRoot): void {
  for (const el of shadow.querySelectorAll<HTMLElement>('[data-nav-cursor]')) {
    el.removeAttribute('data-nav-cursor');
    for (const pill of [
      el,
      ...separatorPills(el),
    ]) {
      pill.style.outline = '';
      pill.style.outlineOffset = '';
      pill.style.background = '';
    }
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
  const viewRef = useRef<ViewHandle>(null);
  // The scroll container CodeView renders (clientHeight = viewport height).
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Logical scrollTop, fed by CodeView's onScroll (it differs from the DOM
  // scrollTop once the view rebases very tall content).
  const scrollTopRef = useRef(0);
  // Fixed end of the selection (set on click / cursor move); shift-click and
  // Shift+J/K extend from here.
  const anchorRef = useRef<{
    line: number;
    side: AnnotationSide;
  } | null>(null);
  // Expand-index of the collapsed bar the keyboard cursor is on (null = on a line).
  const sepCursorRef = useRef<string | null>(null);
  // How far each collapsed bar has been expanded — kept in lockstep with the
  // renderer's own expansion (instance.expandHunk) so buildNavStops turns the
  // revealed lines into real stops. State (drives the navStops rebuild) plus a
  // ref (read by the []-deps keydown listener).
  const [expandedHunks, setExpandedHunks] = useState<ExpansionMap>(() => new Map());
  const expandedHunksRef = useRef<ExpansionMap>(expandedHunks);
  expandedHunksRef.current = expandedHunks;
  // Last bg color pushed onto the scroller, so the per-render bg sync only
  // writes when the diff's surface color actually changes (see onPostRender).
  const lastBgRef = useRef<string | null>(null);
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

  // Parse the diff ONCE — the renderer (CodeView item) and the keyboard model
  // both consume this object, so they can never disagree about hunks or lines.
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
  // Rebuilds when a bar is expanded so the revealed lines become real stops.
  const navStops = useMemo(
    () => (fileDiff ? buildNavStops(fileDiff, diffStyle, countLines(newContents), expandedHunks) : []),
    [
      fileDiff,
      diffStyle,
      newContents,
      expandedHunks,
    ],
  );
  const navStopsRef = useRef<NavStop[]>([]);
  navStopsRef.current = navStops;
  // Rebuild stops for a hypothetical expansion map, closing over the current
  // render's diff/inputs. recordExpansion uses this to refresh navStopsRef
  // synchronously, so a j/k pressed in the same frame as an expand already sees
  // the revealed lines (setExpandedHunks only updates the model on re-render).
  const rebuildNavStopsRef = useRef<(expanded: ExpansionMap) => NavStop[]>(() => []);
  rebuildNavStopsRef.current = (expanded: ExpansionMap) =>
    fileDiff ? buildNavStops(fileDiff, diffStyle, countLines(newContents), expanded) : [];

  // Advance our expansion map the way the renderer advances its own — the
  // single bookkeeping point for BOTH expansion entry points (Enter on a bar,
  // and mouse clicks on a bar's pill/buttons). Count may be Infinity
  // (shift-click / "Expand all"); the clamping in buildNavStops handles it.
  const recordExpansion = (expandIndex: number, direction: 'up' | 'down' | 'both', count: number) => {
    const region = {
      ...(expandedHunksRef.current.get(expandIndex) ?? {
        fromStart: 0,
        fromEnd: 0,
      }),
    };
    if (direction === 'up' || direction === 'both') {
      region.fromStart += count;
    }
    if (direction === 'down' || direction === 'both') {
      region.fromEnd += count;
    }
    const nextExpanded = new Map(expandedHunksRef.current);
    nextExpanded.set(expandIndex, region);
    expandedHunksRef.current = nextExpanded;
    navStopsRef.current = rebuildNavStopsRef.current(nextExpanded);
    setExpandedHunks(nextExpanded);
  };

  const filePath = file?.path ?? '';
  // Item id doubles as the React key: a new file remounts the view, so each
  // file opens scrolled to the top with no leftover layout state.
  const itemId = file ? `${filePath}:${file.staged ? 'staged' : 'unstaged'}` : '';
  const itemIdRef = useRef('');
  itemIdRef.current = itemId;

  // Per-file cursor + expansion state dies with the file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: itemId is the reset trigger, not an input.
  useEffect(() => {
    anchorRef.current = null;
    sepCursorRef.current = null;
    hoveredLineRef.current = null;
    scrollTopRef.current = 0;
    lastBgRef.current = null;
    setExpandedHunks(new Map());
  }, [
    itemId,
  ]);

  // A bar fully revealed by expansion is no longer a gap stop. Drop the bar
  // cursor when its stop disappears so the next j/k resolves from the line
  // selection (which sits just before the now-revealed lines) and steps
  // straight into them instead of being stuck on a phantom bar.
  useEffect(() => {
    if (sepCursorRef.current != null && gapStopIndex(navStops, Number(sepCursorRef.current)) === -1) {
      sepCursorRef.current = null;
    }
  }, [
    navStops,
  ]);

  // Anchor annotations (and the draft composer) at the end of the range, so a
  // multi-line comment appears just below the block it covers.
  const annotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(
    () => [
      ...fileComments.map((comment) => ({
        side: comment.endSide ?? comment.side,
        lineNumber: comment.endLine ?? comment.line,
        metadata: {
          kind: 'comment' as const,
          id: comment.id,
        },
      })),
      ...(draft && draft.path === filePath
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
    ],
    [
      fileComments,
      draft,
      filePath,
    ],
  );

  // Controlled items: CodeView only re-reads an item when its `version`
  // changes (matching versions keep the current snapshot), so bump it
  // whenever the payload (diff or annotations) does. Selection changes do
  // NOT touch the item — moving the cursor never rebuilds the diff.
  const versionRef = useRef(0);
  const items = useMemo<CodeViewDiffItem<AnnotationMeta>[]>(() => {
    if (!fileDiff || !itemId) {
      return [];
    }
    versionRef.current += 1;
    return [
      {
        id: itemId,
        type: 'diff',
        fileDiff,
        annotations,
        version: versionRef.current,
      },
    ];
  }, [
    fileDiff,
    annotations,
    itemId,
  ]);

  const renderAnnotation = useCallback<NonNullable<CodeViewProps<AnnotationMeta>['renderAnnotation']>>(
    (annotation) => {
      const meta = annotation.metadata as AnnotationMeta;
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
    },
    [
      draft,
      closeDraft,
      fileComments,
    ],
  );

  // The view reports selection changes (gutter drags, programmatic writes)
  // through one channel; the store stays the source of truth.
  const handleSelectionChange = useCallback(
    (
      selection: {
        id: string;
        range: SelectedLineRange;
      } | null,
    ) => {
      setSelectedLines(selection?.range ?? null);
    },
    [
      setSelectedLines,
    ],
  );

  const handleScroll = useCallback((scrollTop: number) => {
    scrollTopRef.current = scrollTop;
  }, []);

  // CodeView value-compares options (shallow) before applying, so stable
  // callback identities here mean cursor moves re-render NOTHING but the
  // selection attributes — no row rebuilds, no scroll restoration.
  const diffOptions = useMemo<DiffViewOptions>(
    () => ({
      diffStyle,
      theme: THEME,
      themeType: 'dark',
      layout: LAYOUT,
      enableLineSelection: true,
      lineHoverHighlight: 'both',
      enableGutterUtility: true,
      // Selection gestures the lib owns (gutter drag) land in the store via
      // onSelectedLinesChange; here we only record the anchor for later
      // shift-click / Shift+J/K extension.
      onLineSelected: (range) => {
        if (range) {
          anchorRef.current = {
            line: range.start,
            side: (range.side ?? 'additions') as AnnotationSide,
          };
        }
      },
      // Click selects just that line; shift-click extends from the anchor.
      // (Items are always diffs; the `in` checks narrow the file|diff union.)
      onLineClick: (props) => {
        if (!('annotationSide' in props)) {
          return;
        }
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
      // Track the hovered line (anchor for a pointer drag); while dragging,
      // extend the selection to the line under the pointer.
      onLineEnter: (props) => {
        if (!('annotationSide' in props)) {
          return;
        }
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
      // The gutter "+" gives the clicked line. If a multi-line selection is
      // active and covers that line, comment on the whole selection.
      onGutterUtilityClick: (range) => {
        const selection = useReviewStore.getState().selectedLines;
        if (selection && selection.end !== selection.start) {
          const lo = Math.min(selection.start, selection.end);
          const hi = Math.max(selection.start, selection.end);
          if (range.start >= lo && range.start <= hi) {
            commentOnRange(filePath, selection);
            return;
          }
        }
        commentOnRange(filePath, range);
      },
      // Runs after each diff render pass — the reliable point at which the
      // theme is applied, so we use it for two render-coupled chores:
      onPostRender: () => {
        const shadow = diffShadow(viewRef.current?.getInstance());
        if (!shadow) {
          return;
        }
        // 1. Match the scroller's background to the diff's own surface. The diff
        // paints a near-black background (pierre's theme) while the app chrome
        // is a lighter gray; without this, a diff shorter than the pane shows a
        // starkly different-colored void below the last line. Sampling the
        // rendered surface (vs hardcoding) keeps it correct across themes.
        const scroller = scrollerRef.current;
        if (scroller) {
          const bg = getComputedStyle(shadow.host as HTMLElement).backgroundColor;
          if (bg && bg !== lastBgRef.current) {
            lastBgRef.current = bg;
            scroller.style.backgroundColor = bg;
          }
        }
        // 2. Virtualization recycles rows, dropping our hand-painted bar cursor;
        // re-assert it.
        clearSeparatorCursor(shadow);
        if (sepCursorRef.current != null) {
          highlightSeparator(shadow, sepCursorRef.current);
        }
      },
    }),
    [
      diffStyle,
      filePath,
      setSelectedLines,
      commentOnRange,
    ],
  );

  // Keyboard navigation in the diff:
  //   j/k        move the cursor one stop; collapsed "N unmodified lines" bars
  //              are stops too (outlined), and Enter/Space expands them.
  //   Shift+J/K  grow/shrink the line selection from the anchor.
  //   ] / [      jump to the next / previous change block, skipping context.
  // (event.code is layout- and shift-independent, so Shift+J still reports KeyJ.)
  //
  // The handler lives in a ref reassigned every render, and the []-effect
  // registers only a trampoline. A directly-registered closure goes stale when
  // react-refresh hot-swaps this module WITHOUT remounting (the []-effect never
  // re-runs) — the symptom is keyboard behavior silently running last-launch
  // code until the app restarts.
  const onKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  onKeyDownRef.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const stops = navStopsRef.current;
    const id = itemIdRef.current;
    const view = viewRef.current?.getInstance();
    if (!id || stops.length === 0 || !view) {
      return;
    }
    const store = useReviewStore.getState();
    const scrollTop = scrollTopRef.current;
    const viewportHeight = scrollerRef.current?.clientHeight ?? 0;

    // Enter / Space expands the collapsed bar the cursor is on — through the
    // model API (no DOM buttons involved). We advance OUR expansion state by
    // the same line count the renderer uses, so buildNavStops reveals exactly
    // the lines the renderer reveals: j/k then steps through them instead of
    // leaping past to the next hunk. We don't scroll — CodeView keeps the
    // viewport anchored across the layout change. If the bar is fully revealed
    // the gap stop vanishes and the [navStops] effect drops sepCursorRef.
    if ((event.key === 'Enter' || event.code === 'Space') && sepCursorRef.current != null) {
      const index = gapStopIndex(stops, Number(sepCursorRef.current));
      const stop = index !== -1 ? (stops[index] as GapStop) : null;
      const instance = renderedDiffInstance(view);
      if (stop && instance) {
        event.preventDefault();
        navLog('expand', {
          expandIndex: stop.expandIndex,
          direction: stop.expandDirection,
        });
        recordExpansion(stop.expandIndex, stop.expandDirection, EXPANSION_LINE_COUNT);
        instance.expandHunk(stop.expandIndex, stop.expandDirection);
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

    // Scroll a stop's row toward view. align:'nearest' is a no-op when the
    // row (plus margin) is already visible; otherwise the view moves the
    // minimum distance. The lib re-resolves the target every frame until
    // the scroll settles, so late row measurements can't strand the cursor.
    const scrollCursorTo = (stop: NavStop) => {
      const anchor = stopAnchor(stop);
      navLog('scrollTo', {
        line: anchor.line,
        side: anchor.side,
      });
      viewRef.current?.scrollTo({
        type: 'line',
        id,
        lineNumber: anchor.line,
        side: anchor.side,
        align: 'nearest',
        offset: NAV_MARGIN,
        behavior: 'instant',
      });
    };

    // Land the cursor on a stop: update selection / bar highlight + scroll.
    // Landing on a bar deliberately does NOT touch the line selection — the
    // bar highlight alone is the cursor; sepCursorRef takes precedence when
    // resolving it below.
    const applyStop = (index: number) => {
      const stop = stops[index];
      const shadow = diffShadow(view);
      if (shadow) {
        clearSeparatorCursor(shadow);
      }
      if (stop.kind === 'gap') {
        sepCursorRef.current = String(stop.expandIndex);
        if (shadow) {
          highlightSeparator(shadow, sepCursorRef.current);
        }
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
      scrollCursorTo(stop);
    };

    // Where is the cursor? Try, in order, the highlighted bar (it outranks
    // the still-present line selection) then the selection's end on its own
    // side — but accept each only if it is actually on screen. A candidate
    // scrolled out of view is skipped, so after expanding a bar that gets
    // pushed off-screen, j/k resumes from the still-visible line selection
    // (stepping straight into the freshly revealed lines) rather than the bar.
    // If neither is visible, resume from the first row in the viewport.
    const selection = store.selectedLines;
    const inView = (index: number) => index !== -1 && stopInViewport(view, id, scrollTop, viewportHeight, stops[index]);
    let cursor = -1;
    if (sepCursorRef.current != null) {
      const barIndex = gapStopIndex(stops, Number(sepCursorRef.current));
      if (inView(barIndex)) {
        cursor = barIndex;
      }
    }
    if (cursor === -1 && selection) {
      const endSide = (selection.endSide ?? selection.side ?? 'additions') as AnnotationSide;
      let selIndex = stopIndexForSelection(stops, selection.end, endSide);
      if (selIndex === -1) {
        // Not a modeled row — a line still hidden behind a bar resolves to that
        // bar's gap stop; anything else falls back to the nearest stop.
        selIndex = gapIndexForLine(stops, selection.end, endSide);
      }
      if (selIndex === -1) {
        selIndex = nearestLineStop(stops, selection.end);
      }
      if (inView(selIndex)) {
        cursor = selIndex;
      }
    }
    if (cursor === -1) {
      navLog('cursor off-screen, resuming from viewport');
      const visible = firstVisibleStopIndex(view, id, scrollTop, viewportHeight, stops);
      if (visible === -1) {
        return;
      }
      // Step "onto" the visible row rather than past it.
      cursor = visible - direction;
    }
    navLog('resolve', {
      cursor,
      stop: stops[cursor],
      sep: sepCursorRef.current,
      sel: selection ? `${selection.end}:${selection.endSide ?? selection.side}` : null,
      scrollTop,
      viewportHeight,
      stopCount: stops.length,
    });

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
      scrollCursorTo(endStop);
      return;
    }

    // Plain j/k — step to the adjacent stop. A bar that was expanded away
    // (its element no longer renders) is skipped; bars adjacent to the
    // in-viewport cursor are inside the render window, so a missing element
    // means expanded, not unrendered.
    const shadow = diffShadow(view);
    let next = cursor + direction;
    while (
      stops[next] &&
      stops[next].kind === 'gap' &&
      shadow &&
      findSeparator(shadow, (stops[next] as GapStop).expandIndex) == null
    ) {
      navLog('skipping expanded-away bar', {
        expandIndex: (stops[next] as GapStop).expandIndex,
      });
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onKeyDownRef.current(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Mouse expansion: clicking a bar's pill or expand buttons is handled
  // entirely inside the diff lib (InteractionManager -> expandHunk), so the nav
  // model would never learn about those revealed lines — j/k would leap past
  // them. Mirror the lib's exact click semantics (shift-click and "Expand all"
  // mean expand-everything) into recordExpansion. Bookkeeping only: the lib
  // still performs the renderer expansion itself.
  const onExpandClickRef = useRef<(event: MouseEvent) => void>(() => {});
  onExpandClickRef.current = (event: MouseEvent) => {
    const root = containerRef.current;
    if (!root || !(event.target instanceof Node) || !root.contains(event.target)) {
      return;
    }
    // Same upward walk as the lib's click target resolution: an expand trigger
    // (button or the "N unmodified lines" pill), then the enclosing separator's
    // expand-index.
    let direction: 'up' | 'down' | 'both' | null = null;
    let all = false;
    let expandIndex: number | null = null;
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      if (direction == null) {
        if (node.hasAttribute('data-expand-button') || node.hasAttribute('data-unmodified-lines')) {
          direction = node.hasAttribute('data-expand-up')
            ? 'up'
            : node.hasAttribute('data-expand-down')
              ? 'down'
              : 'both';
          all = node.hasAttribute('data-expand-all-button');
        }
        continue;
      }
      const attr = node.getAttribute('data-expand-index');
      if (attr != null) {
        const parsed = Number.parseInt(attr, 10);
        if (!Number.isNaN(parsed)) {
          expandIndex = parsed;
        }
        break;
      }
    }
    if (direction == null || expandIndex == null) {
      return;
    }
    const full = all || event.shiftKey;
    navLog('expand (click)', {
      expandIndex,
      direction: full ? 'both' : direction,
      full,
    });
    recordExpansion(expandIndex, full ? 'both' : direction, full ? Number.POSITIVE_INFINITY : EXPANSION_LINE_COUNT);
  };
  useEffect(() => {
    // Capture phase: the lib's own click handler lives inside the shadow root
    // and may stop propagation; capture sees the click regardless.
    const onClick = (event: MouseEvent) => onExpandClickRef.current(event);
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, []);

  // When a line gets selected (click, drag, Shift+J/K), drop any bar highlight.
  useEffect(() => {
    if (selectedLines) {
      const shadow = diffShadow(viewRef.current?.getInstance());
      if (shadow) {
        clearSeparatorCursor(shadow);
      }
      sepCursorRef.current = null;
    }
  }, [
    selectedLines,
  ]);

  // Pointer-drag selection on the code area. The anchor is whatever line the
  // pointer is over at mousedown (tracked via onLineEnter); onLineEnter then
  // extends to the line under the pointer while dragging. Ref-trampolined for
  // the same hot-swap reason as the keydown handler above.
  const onPointerDownRef = useRef<(event: PointerEvent) => void>(() => {});
  onPointerDownRef.current = (event: PointerEvent) => {
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
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => onPointerDownRef.current(event);
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
        <CodeView<AnnotationMeta>
          key={itemId}
          ref={viewRef}
          containerRef={scrollerRef}
          className="min-h-0 flex-1 overflow-auto bg-background select-none"
          items={items}
          options={diffOptions}
          selectedLines={
            selectedLines
              ? {
                  id: itemId,
                  range: selectedLines,
                }
              : null
          }
          onSelectedLinesChange={handleSelectionChange}
          onScroll={handleScroll}
          renderAnnotation={renderAnnotation}
          disableWorkerPool
        />
      )}
    </div>
  );
}
