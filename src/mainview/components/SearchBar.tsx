// Cmd+F find bar: a browser-style overlay that searches the text of whatever
// mode is showing (diff, commit page, range compare, markdown preview, …).
// Opened via the native menu (Edit ▸ Find…) which flips the store's `search`
// flag.
//
// Two search strategies, picked by mode:
//
//   • Diff view — VIRTUALIZED, so the DOM only holds rows near the viewport.
//     We search the DiffPane's published model (store.diffSearch: every shown
//     row's text + the line/side CodeView scrolls to) for a STABLE total count
//     and to reach matches anywhere in the file. Navigation sets a scrollTarget
//     (the same one jump-to-comment uses); once the row is rendered we paint it.
//
//   • Everything else — not virtualized, so a DOM walk sees all of it. We
//     collect match Ranges directly and paint every one.
//
// Painting (both modes): matches are drawn as absolutely-positioned rectangles
// computed from each Range's getClientRects(). We do NOT use the CSS Custom
// Highlight API — WKWebView (the Electrobun runtime) registers highlights but
// never paints them. The overlay renders identically in Chromium and WKWebView
// and never mutates the content DOM.
//
// Shadow DOM: @pierre/diffs renders each diff inside a <diffs-container> web
// component with its own shadow root, so a plain TreeWalker can't see the diff
// text — we descend into shadow roots explicitly. Each Range stays within one
// tree; we never build a Range that straddles a shadow boundary.

import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationSide } from '../../shared/types';
import { NO_DRAG_REGION } from '../lib/dragRegion';
import { useReviewStore } from '../store';

// Guard against pathological queries (e.g. a single common letter) painting
// tens of thousands of rects and stalling the renderer.
const MAX_MATCHES = 5000;
const FILL_ALL = 'rgba(250, 204, 21, 0.4)'; // amber
const FILL_ACTIVE = 'rgba(249, 115, 22, 0.5)'; // orange
const OUTLINE_ACTIVE = '1.5px solid rgba(234, 88, 12, 0.95)';

interface DiffMatch {
  line: number;
  side: AnnotationSide;
}

/** Collect text nodes under `root` in DFS order, descending into shadow roots
 * (which a TreeWalker won't enter on its own). Each returned array shares one
 * tree, so Ranges built from it never straddle a shadow boundary. */
function collectScopes(root: Node): Text[][] {
  const scopes: Text[][] = [];
  const visit = (host: Node) => {
    const textNodes: Text[] = [];
    const nestedShadows: ShadowRoot[] = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue) {
          textNodes.push(node as Text);
        }
      } else {
        const shadow = (node as Element).shadowRoot;
        if (shadow) {
          nestedShadows.push(shadow);
        }
      }
    }
    scopes.push(textNodes);
    for (const nested of nestedShadows) {
      visit(nested);
    }
  };
  visit(root);
  return scopes;
}

/** Match `needle` (case-insensitive) within one tree's text nodes, returning
 * Ranges. The flattened-text approach lets a match span the many token <span>s
 * a syntax-highlighted line is split into, while staying inside this tree. */
function rangesForNodes(textNodes: Text[], needle: string, remaining: number): Range[] {
  if (textNodes.length === 0 || remaining <= 0) {
    return [];
  }
  const ends: number[] = [];
  let full = '';
  for (const node of textNodes) {
    full += node.nodeValue ?? '';
    ends.push(full.length);
  }

  const haystack = full.toLowerCase();
  const ranges: Range[] = [];
  let startNode = 0;
  let endNode = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    const matchEnd = at + needle.length;
    while (ends[startNode] <= at) {
      startNode++;
    }
    if (endNode < startNode) {
      endNode = startNode;
    }
    while (ends[endNode] < matchEnd) {
      endNode++;
    }
    const range = document.createRange();
    const startBase = startNode === 0 ? 0 : ends[startNode - 1];
    const endBase = endNode === 0 ? 0 : ends[endNode - 1];
    range.setStart(textNodes[startNode], at - startBase);
    range.setEnd(textNodes[endNode], matchEnd - endBase);
    ranges.push(range);
    if (ranges.length >= remaining) {
      break;
    }
  }
  return ranges;
}

/** Every match Range currently in the DOM under `root` (lowercased `needle`). */
function renderedRanges(root: HTMLElement, needle: string): Range[] {
  if (needle === '') {
    return [];
  }
  let ranges: Range[] = [];
  for (const textNodes of collectScopes(root)) {
    ranges = ranges.concat(rangesForNodes(textNodes, needle, MAX_MATCHES - ranges.length));
    if (ranges.length >= MAX_MATCHES) {
      break;
    }
  }
  return ranges;
}

/** Index of the range whose vertical center is closest to the clip's center —
 * used in diff mode, where we scroll the active match to center, to tell which
 * rendered match is the active one (the model index doesn't map to DOM order). */
function nearestCenterIndex(ranges: Range[], clip: DOMRect): number {
  const target = (clip.top + clip.bottom) / 2;
  let best = Infinity;
  let index = -1;
  ranges.forEach((range, i) => {
    const bounds = range.getBoundingClientRect();
    if (bounds.width === 0 && bounds.height === 0) {
      return;
    }
    const distance = Math.abs((bounds.top + bounds.bottom) / 2 - target);
    if (distance < best) {
      best = distance;
      index = i;
    }
  });
  return index;
}

export function SearchBar() {
  const open = useReviewStore((state) => state.search);
  const setSearch = useReviewStore((state) => state.setSearch);
  const query = useReviewStore((state) => state.searchQuery);
  const setSearchQuery = useReviewStore((state) => state.setSearchQuery);
  const setScrollTarget = useReviewStore((state) => state.setScrollTarget);
  const diffSearch = useReviewStore((state) => state.diffSearch);
  const selectedPath = useReviewStore((state) => state.selectedPath);

  // Diff mode = the published diff model matches the shown file. Otherwise the
  // content is plain (non-virtualized) DOM we can walk in full.
  const diffMode = diffSearch != null && diffSearch.path === selectedPath;

  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const domRangesRef = useRef<Range[]>([]); // non-diff modes: all matches
  const diffMatchesRef = useRef<DiffMatch[]>([]); // diff mode: model matches
  const activeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const observersRef = useRef<Map<Node, MutationObserver>>(new Map());
  const [count, setCount] = useState(0);
  const [active, setActive] = useState(0);

  // Latest values the long-lived listeners/observers must read without
  // re-binding (they capture refs, not the render closure).
  const queryRef = useRef(query);
  queryRef.current = query.toLowerCase();
  const diffModeRef = useRef(diffMode);
  diffModeRef.current = diffMode;

  // Draw a rect over every rendered match (clipped to the content pane), the
  // active one outlined. In diff mode the active match is whichever rendered
  // match sits at center (we scrolled it there); otherwise it's the active
  // index into the full match list.
  const paintOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const scope = document.getElementById('search-scope');
    if (!overlay || !scope) {
      return;
    }
    const ranges = diffModeRef.current ? renderedRanges(scope, queryRef.current) : domRangesRef.current;
    if (ranges.length === 0) {
      overlay.replaceChildren();
      return;
    }
    const clip = scope.getBoundingClientRect();
    const activeIndex = diffModeRef.current ? nearestCenterIndex(ranges, clip) : activeRef.current;
    const fragment = document.createDocumentFragment();
    ranges.forEach((range, index) => {
      const bounds = range.getBoundingClientRect();
      if (bounds.bottom <= clip.top || bounds.top >= clip.bottom || bounds.width === 0) {
        return;
      }
      const isActive = index === activeIndex;
      for (const rect of range.getClientRects()) {
        const left = Math.max(rect.left, clip.left);
        const top = Math.max(rect.top, clip.top);
        const right = Math.min(rect.right, clip.right);
        const bottom = Math.min(rect.bottom, clip.bottom);
        if (right <= left || bottom <= top) {
          continue;
        }
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;border-radius:2px;pointer-events:none;background-color:${
          isActive ? FILL_ACTIVE : FILL_ALL
        };${isActive ? `outline:${OUTLINE_ACTIVE};outline-offset:-1px;` : ''}`;
        fragment.append(box);
      }
    });
    overlay.replaceChildren(fragment);
  }, []);

  // rAF-throttled repaint for scroll/resize bursts.
  const schedulePaint = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paintOverlay();
    });
  }, [
    paintOverlay,
  ]);

  // Repaint now and again shortly after — diff navigation scrolls async (the
  // CodeView waits for highlight), so the match lands a few frames later and a
  // single paint would miss it.
  const repaintSoon = useCallback(() => {
    schedulePaint();
    for (const delay of [
      60,
      180,
      360,
    ]) {
      timersRef.current.push(setTimeout(schedulePaint, delay));
    }
  }, [
    schedulePaint,
  ]);

  // Jump to the i-th diff match: scroll its row into view (the DiffPane consumes
  // the scrollTarget), then repaint once it renders.
  const jumpToDiffMatch = useCallback(
    (index: number) => {
      const match = diffMatchesRef.current[index];
      if (!match || !selectedPath) {
        return;
      }
      setScrollTarget({
        path: selectedPath,
        line: match.line,
        side: match.side,
      });
      repaintSoon();
    },
    [
      selectedPath,
      setScrollTarget,
      repaintSoon,
    ],
  );

  // Scroll a non-diff match into view (its node is always in the DOM).
  const scrollDomMatch = useCallback((index: number) => {
    domRangesRef.current[index]?.startContainer.parentElement?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
    });
  }, []);

  // Recompute the match set for the current query. `reset` (a fresh query) jumps
  // to the first match; otherwise the active index is preserved (clamped).
  const recompute = useCallback(
    (reset: boolean) => {
      const root = document.getElementById('search-scope');
      if (!root) {
        return;
      }
      const needle = query.toLowerCase();

      if (diffMode) {
        const matches: DiffMatch[] = [];
        if (needle !== '') {
          for (const row of diffSearch.lines) {
            const hay = row.text.toLowerCase();
            for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
              matches.push({
                line: row.line,
                side: row.side,
              });
              if (matches.length >= MAX_MATCHES) {
                break;
              }
            }
            if (matches.length >= MAX_MATCHES) {
              break;
            }
          }
        }
        diffMatchesRef.current = matches;
        setCount(matches.length);
        const next = matches.length === 0 ? 0 : reset ? 0 : Math.min(activeRef.current, matches.length - 1);
        activeRef.current = next;
        setActive(next);
        if (matches.length > 0) {
          jumpToDiffMatch(next);
        } else {
          paintOverlay();
        }
      } else {
        const ranges = renderedRanges(root, needle);
        domRangesRef.current = ranges;
        setCount(ranges.length);
        const next = ranges.length === 0 ? 0 : reset ? 0 : Math.min(activeRef.current, ranges.length - 1);
        activeRef.current = next;
        setActive(next);
        paintOverlay();
        if (reset && ranges.length > 0) {
          scrollDomMatch(next);
        }
      }

      // (Re)observe the document scope and every shadow root so changes
      // underneath us (virtualizer row swaps, async renders) repaint.
      const liveRoots = new Set<Node>([
        root,
      ]);
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) {
          liveRoots.add(node.shadowRoot);
        }
      }
      const observers = observersRef.current;
      for (const [node, observer] of observers) {
        if (!liveRoots.has(node)) {
          observer.disconnect();
          observers.delete(node);
        }
      }
      for (const node of liveRoots) {
        if (observers.has(node)) {
          continue;
        }
        const observer = new MutationObserver(() => observerTickRef.current());
        observer.observe(node, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        observers.set(node, observer);
      }
    },
    [
      diffMode,
      diffSearch,
      query,
      jumpToDiffMatch,
      scrollDomMatch,
      paintOverlay,
    ],
  );

  // What observers fire. Diff mode only needs a repaint (the model is the
  // source of truth); non-diff modes re-collect ranges since the DOM changed.
  const observerTickRef = useRef<() => void>(() => {});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    observerTickRef.current = () => {
      if (diffModeRef.current) {
        schedulePaint();
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => recompute(true), 120);
    };
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    recompute,
    schedulePaint,
  ]);

  const step = useCallback(
    (delta: number) => {
      const total = count;
      if (total === 0) {
        return;
      }
      const next = (activeRef.current + delta + total) % total;
      activeRef.current = next;
      setActive(next);
      if (diffModeRef.current) {
        jumpToDiffMatch(next);
      } else {
        scrollDomMatch(next);
        paintOverlay();
      }
    },
    [
      count,
      jumpToDiffMatch,
      scrollDomMatch,
      paintOverlay,
    ],
  );

  // Open/close lifecycle. Focus+select runs ONLY on open — doing it on every
  // query change would re-select the field after each keystroke, so only one
  // character would ever stick.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    overlayRef.current?.replaceChildren();
    for (const observer of observersRef.current.values()) {
      observer.disconnect();
    }
    observersRef.current.clear();
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current = [];
    domRangesRef.current = [];
    diffMatchesRef.current = [];
    activeRef.current = 0;
    setCount(0);
    setActive(0);
  }, [
    open,
  ]);

  // Re-scan whenever the bar is open and the query/mode/file changes.
  useEffect(() => {
    if (open) {
      recompute(true);
    }
  }, [
    open,
    recompute,
  ]);

  // Keep the overlay aligned as anything scrolls or the window resizes. Capture
  // phase so the nested diff scroller is caught.
  useEffect(() => {
    if (!open) {
      return;
    }
    window.addEventListener('scroll', schedulePaint, true);
    window.addEventListener('resize', schedulePaint);
    return () => {
      window.removeEventListener('scroll', schedulePaint, true);
      window.removeEventListener('resize', schedulePaint);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    open,
    schedulePaint,
  ]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        ref={overlayRef}
        className="pointer-events-none fixed inset-0 z-30"
        aria-hidden
      />
      <div
        className={`absolute top-2 right-2 z-40 flex items-center gap-1 rounded-lg bg-popover/95 p-1 pl-2.5 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl ${NO_DRAG_REGION}`}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setSearch(false);
            }
          }}
          placeholder="Find in view…"
          className="w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <span className="min-w-[3.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {query === '' ? '' : count === 0 ? 'No results' : `${active + 1}/${count}`}
        </span>
        <button
          type="button"
          aria-label="Previous match"
          disabled={count === 0}
          onClick={() => step(-1)}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Next match"
          disabled={count === 0}
          onClick={() => step(1)}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronDown className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Close find"
          onClick={() => setSearch(false)}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </>
  );
}
