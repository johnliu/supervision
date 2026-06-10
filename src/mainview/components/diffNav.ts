// Keyboard-navigation model for the diff viewer.
//
// First principles: the renderer and the keyboard share ONE source of truth —
// the parsed diff (`parseDiffFromFile`, the same call MultiFileDiff makes
// internally). From its hunks we precompute the exact sequence of visual rows
// ("stops") for the current view mode, in the order they appear on screen.
// The keyboard cursor is an index into that array: j/k is ±1, ] / [ jumps
// between change blocks, and a collapsed-context bar is a single stop.
//
// Because the model is pure data, virtualization, re-renders, and scroll
// position cannot confuse the cursor. The DOM is only consulted for the two
// questions that are genuinely about the screen: "which row is visible?" and
// "scroll this row into view" — both live in DiffPane, not here.
//
// Known, accepted simplification: lines revealed by expanding a collapsed bar
// ("context-expanded") are NOT stops — after expanding, j/k continues to the
// next hunk line. Clicking an expanded line still works: the cursor resolves
// to the nearest modeled stop.

import type { FileDiffMetadata } from '@pierre/diffs';
import type { AnnotationSide } from '../../shared/types';
import type { DiffStyle } from '../store';

export interface LineStop {
  kind: 'line';
  /** Line number + side to select when the cursor lands here. Rows with an
   * additions-side cell select that side; pure-deletion rows select left. */
  line: number;
  side: AnnotationSide;
  /** File line numbers on each side, when the row has a cell there. A split
   * context/modified row carries both, so a selection made on EITHER side
   * resolves back to this stop (line numbers alone are ambiguous: new-file
   * line N and old-file line N are different rows). */
  addLine: number | null;
  delLine: number | null;
  /** True when the row is part of a change block (vs unchanged context). */
  change: boolean;
}

export interface GapStop {
  kind: 'gap';
  /** Matches the renderer's `data-expand-index` (the hunk index; the trailing
   * bar is `hunks.length`), so the bar can be highlighted and expanded. */
  expandIndex: number;
  /** Unchanged lines hidden behind the bar. */
  lines: number;
  /** The new-file line range this gap covers (inclusive). A selection on a
   * line revealed by expanding the bar falls inside this range and resolves
   * to the gap stop. */
  addStart: number;
  addEnd: number;
  /** The old-file line range this gap covers (inclusive). */
  delStart: number;
  delEnd: number;
}

export type NavStop = LineStop | GapStop;

/** Lines in `contents`, ignoring a trailing newline (matching diff line counts). */
export function countLines(contents: string): number {
  if (contents.length === 0) {
    return 0;
  }
  const lines = contents.split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * The visual rows of the rendered diff, top to bottom, for `diffStyle`.
 *
 * Walks each hunk's `hunkContent` (ordered context/change groups) keeping
 * running line counters from `additionStart`/`deletionStart`:
 *   - context group of N lines → N stops, each present on both sides;
 *   - change group → unified: all deletions then all additions, one stop each;
 *     split: max(deletions, additions) stops, row i pairing deletion i with
 *     addition i (the renderer aligns columns the same way);
 *   - a hunk with `collapsedBefore > 0` is preceded by a gap stop, and lines
 *     after the last hunk produce a trailing gap stop.
 */
export function buildNavStops(
  diff: FileDiffMetadata,
  diffStyle: DiffStyle,
  newFileLines: number,
  oldFileLines: number,
): NavStop[] {
  const stops: NavStop[] = [];

  diff.hunks.forEach((hunk, hunkIndex) => {
    if (hunk.collapsedBefore > 0) {
      stops.push({
        kind: 'gap',
        expandIndex: hunkIndex,
        lines: hunk.collapsedBefore,
        addStart: hunk.additionStart - hunk.collapsedBefore,
        addEnd: hunk.additionStart - 1,
        delStart: hunk.deletionStart - hunk.collapsedBefore,
        delEnd: hunk.deletionStart - 1,
      });
    }
    let addLine = hunk.additionStart;
    let delLine = hunk.deletionStart;
    for (const group of hunk.hunkContent) {
      if (group.type === 'context') {
        for (let i = 0; i < group.lines; i++) {
          stops.push({
            kind: 'line',
            line: addLine,
            side: 'additions',
            addLine,
            delLine,
            change: false,
          });
          addLine++;
          delLine++;
        }
      } else if (diffStyle === 'unified') {
        for (let i = 0; i < group.deletions; i++) {
          stops.push({
            kind: 'line',
            line: delLine,
            side: 'deletions',
            addLine: null,
            delLine,
            change: true,
          });
          delLine++;
        }
        for (let i = 0; i < group.additions; i++) {
          stops.push({
            kind: 'line',
            line: addLine,
            side: 'additions',
            addLine,
            delLine: null,
            change: true,
          });
          addLine++;
        }
      } else {
        const rows = Math.max(group.deletions, group.additions);
        for (let i = 0; i < rows; i++) {
          const del = i < group.deletions ? delLine++ : null;
          const add = i < group.additions ? addLine++ : null;
          stops.push({
            kind: 'line',
            line: (add ?? del) as number,
            side: add != null ? 'additions' : 'deletions',
            addLine: add,
            delLine: del,
            change: true,
          });
        }
      }
    }
  });

  const last = diff.hunks[diff.hunks.length - 1];
  if (last) {
    const renderedThrough = last.additionStart + last.additionCount - 1;
    if (renderedThrough < newFileLines) {
      stops.push({
        kind: 'gap',
        expandIndex: diff.hunks.length,
        lines: newFileLines - renderedThrough,
        addStart: renderedThrough + 1,
        addEnd: newFileLines,
        delStart: last.deletionStart + last.deletionCount,
        delEnd: oldFileLines,
      });
    }
  }

  return stops;
}

/**
 * Index of the gap stop whose hidden range contains `line` on `side`, or -1.
 * Resolves a selection on a line revealed by expanding a bar (those lines are
 * not stops) to the bar itself, so navigation continues from the right place.
 */
export function gapIndexForLine(stops: NavStop[], line: number, side: AnnotationSide): number {
  return stops.findIndex(
    (stop) =>
      stop.kind === 'gap' &&
      (side === 'deletions'
        ? line >= stop.delStart && line <= stop.delEnd
        : line >= stop.addStart && line <= stop.addEnd),
  );
}

/** Index of the stop holding a selection that ends on `line`/`side`, or -1. */
export function stopIndexForSelection(stops: NavStop[], line: number, side: AnnotationSide): number {
  return stops.findIndex(
    (stop) => stop.kind === 'line' && (side === 'deletions' ? stop.delLine === line : stop.addLine === line),
  );
}

/** Index of the gap stop with the given expand-index, or -1. */
export function gapStopIndex(stops: NavStop[], expandIndex: number): number {
  return stops.findIndex((stop) => stop.kind === 'gap' && stop.expandIndex === expandIndex);
}

/**
 * Fallback resolution when a selection doesn't match any stop (e.g. the user
 * clicked a line revealed by expanding a bar): the line stop nearest to `line`
 * on either side.
 */
export function nearestLineStop(stops: NavStop[], line: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  stops.forEach((stop, index) => {
    if (stop.kind !== 'line') {
      return;
    }
    const distance = Math.min(
      stop.addLine != null ? Math.abs(stop.addLine - line) : Number.POSITIVE_INFINITY,
      stop.delLine != null ? Math.abs(stop.delLine - line) : Number.POSITIVE_INFINITY,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/**
 * Index of the first stop of the next/previous change block from `from`
 * (wrapping), or -1 when the diff has no changes. A block start is a change
 * stop whose predecessor isn't a change stop.
 */
export function nextChangeIndex(stops: NavStop[], from: number, direction: 1 | -1): number {
  const starts: number[] = [];
  stops.forEach((stop, index) => {
    const previous = stops[index - 1];
    if (stop.kind === 'line' && stop.change && !(previous?.kind === 'line' && previous.change)) {
      starts.push(index);
    }
  });
  if (starts.length === 0) {
    return -1;
  }
  if (direction > 0) {
    return starts.find((index) => index > from) ?? starts[0];
  }
  return (
    [
      ...starts,
    ]
      .reverse()
      .find((index) => index < from) ?? starts[starts.length - 1]
  );
}
