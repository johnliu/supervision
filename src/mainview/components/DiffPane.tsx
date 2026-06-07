// Renders the selected file's diff using @pierre/diffs. `diffStyle` switches
// between unified and split. Clicking anywhere on a line selects it; drag /
// shift-click extend the selection; j/k move the single-line cursor. A "+"
// appears in the gutter to open an inline comment composer. Existing comments
// render inline as annotations at their end line.

import { type DiffLineAnnotation, MultiFileDiff, Virtualizer } from '@pierre/diffs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

// Scroll a cursor line into view; if it isn't rendered (collapsed/virtualized),
// nudge the viewport in the move direction so it scrolls toward it.
function scrollLineIntoView(root: HTMLElement, line: number, direction: number): void {
  const cell = findLineCell(root, line);
  if (cell) {
    cell.scrollIntoView({
      block: 'nearest',
    });
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

// Navigable cursor stops top-to-bottom: code lines plus collapsed-context bars,
// scoped to the additions column (split) or the whole diff (unified).
function navStops(shadow: ShadowRoot): HTMLElement[] {
  const scope = shadow.querySelector('[data-additions]') ?? shadow;
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-column-number], [data-separator]'));
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
          endSide: 'additions',
        });
        scrollLineIntoView(root, end, direction);
        return;
      }

      // Plain j/k: step through stops (lines + collapsed bars) in view order.
      const stops = shadow ? navStops(shadow) : [];
      if (stops.length === 0) {
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
      const isLine = (el: HTMLElement) => el.hasAttribute('data-column-number');
      let current = -1;
      if (selection) {
        current = stops.findIndex(
          (el) => isLine(el) && el.getAttribute('data-column-number') === String(selection.end),
        );
      } else if (sepCursorRef.current != null) {
        current = stops.findIndex(
          (el) => !isLine(el) && (el.getAttribute('data-expand-index') ?? '') === sepCursorRef.current,
        );
      }
      if (current === -1) {
        // No live cursor (e.g. just expanded a bar): resume from the top of view.
        const line = firstRenderedLine(root);
        if (line != null) {
          current = stops.findIndex((el) => isLine(el) && el.getAttribute('data-column-number') === String(line));
        }
      }
      const nextIndex =
        current === -1
          ? direction > 0
            ? 0
            : stops.length - 1
          : Math.min(stops.length - 1, Math.max(0, current + direction));
      const el = stops[nextIndex];
      if (shadow) {
        clearSeparatorCursor(shadow);
      }
      if (isLine(el)) {
        const line = Number(el.getAttribute('data-column-number'));
        sepCursorRef.current = null;
        anchorRef.current = {
          line,
          side: 'additions',
        };
        store.setSelectedLines({
          start: line,
          end: line,
          side: 'additions',
          endSide: 'additions',
        });
      } else if (shadow) {
        const index = el.getAttribute('data-expand-index') ?? '';
        sepCursorRef.current = index;
        highlightSeparator(shadow, index);
        store.setSelectedLines(null);
      }
      el.scrollIntoView({
        block: 'nearest',
      });
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
