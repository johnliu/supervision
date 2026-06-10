// Unit tests for the keyboard-navigation stop model. Test titles embed the
// spec IDs they enforce — see docs/specs/diff-navigation.md.
//
// Diffs are produced by the REAL parser (parseDiffFromFile) from contents
// generated with the same builders the web fixtures use, so these tests and
// the e2e fixtures cannot drift apart.

import { describe, expect, it } from 'bun:test';
import { parseDiffFromFile } from '@pierre/diffs';
import { editLines, genLines, insertAfter, joinContents, removeRange } from '../web/fixtures/builders';
import {
  buildNavStops,
  countLines,
  type ExpansionMap,
  type GapStop,
  gapIndexForLine,
  type LineStop,
  type NavStop,
  nearestLineStop,
  nextChangeIndex,
  stopIndexForSelection,
} from './diffNav';

function parse(oldLines: string[], newLines: string[]) {
  return parseDiffFromFile(
    {
      name: 'test.ts',
      contents: joinContents(oldLines),
    },
    {
      name: 'test.ts',
      contents: joinContents(newLines),
    },
    {},
  );
}

function stops(
  oldLines: string[],
  newLines: string[],
  style: 'split' | 'unified' = 'split',
  expanded: ExpansionMap = new Map(),
): NavStop[] {
  return buildNavStops(parse(oldLines, newLines), style, countLines(joinContents(newLines)), expanded);
}

const lineStops = (all: NavStop[]) => all.filter((s): s is LineStop => s.kind === 'line');
const gapStops = (all: NavStop[]) => all.filter((s): s is GapStop => s.kind === 'gap');

/** 20-line file with one edit at line 10. The parser uses 4 lines of context,
 * so the hunk covers 6-14: leading gap 1-5, trailing gap 15-20. */
function oneEditFile() {
  const old = genLines(20);
  const next = editLines(old, {
    10: 'line 10: edited',
  });
  return {
    old,
    next,
  };
}

describe('stop model', () => {
  it('STOP-1: enumerates rows in render order — leading gap, hunk rows, trailing gap', () => {
    const { old, next } = oneEditFile();
    const all = stops(old, next);
    // Leading gap, 4 context, 1 change row (split pairs del+add), 4 context, trailing gap.
    expect(all[0]?.kind).toBe('gap');
    expect(all.at(-1)?.kind).toBe('gap');
    const lines = lineStops(all);
    expect(lines.map((s) => s.addLine)).toEqual([
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
    ]);
    expect(lines.map((s) => s.change)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(all).toHaveLength(11);
  });

  it('STOP-2: unified change groups emit all deletions then all additions', () => {
    // Replace old lines 10-11 with a single new line: 2 deletions, 1 addition.
    const old = genLines(30);
    let next = removeRange(old, 10, 11);
    next = insertAfter(next, 9, [
      'line 10: replacement',
    ]);
    const unified = stops(old, next, 'unified');
    const changes = lineStops(unified).filter((s) => s.change);
    expect(
      changes.map((s) => [
        s.side,
        s.delLine,
        s.addLine,
      ]),
    ).toEqual([
      [
        'deletions',
        10,
        null,
      ],
      [
        'deletions',
        11,
        null,
      ],
      [
        'additions',
        null,
        10,
      ],
    ]);
  });

  it('STOP-3: split change groups pair deletion i with addition i', () => {
    const old = genLines(30);
    let next = removeRange(old, 10, 11);
    next = insertAfter(next, 9, [
      'line 10: replacement',
    ]);
    const split = stops(old, next, 'split');
    const changes = lineStops(split).filter((s) => s.change);
    // max(2 deletions, 1 addition) = 2 rows; row 0 pairs del 10 with add 10,
    // row 1 is deletion-only.
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      side: 'additions',
      addLine: 10,
      delLine: 10,
    });
    expect(changes[1]).toMatchObject({
      side: 'deletions',
      addLine: null,
      delLine: 11,
    });
  });

  it('STOP-4 / CUR-2: context rows carry both sides and resolve from either; change rows resolve per side', () => {
    const { old, next } = oneEditFile();
    const all = stops(old, next);
    const context9 = lineStops(all).find((s) => s.addLine === 9);
    expect(context9?.delLine).toBe(9);
    // Same stop from either side of a context row.
    expect(stopIndexForSelection(all, 9, 'additions')).toBe(stopIndexForSelection(all, 9, 'deletions'));
    // A deletions-side selection resolves on its own side (CUR-2).
    const delIndex = stopIndexForSelection(all, 10, 'deletions');
    expect(delIndex).toBeGreaterThan(-1);
    expect((all[delIndex] as LineStop).delLine).toBe(10);
  });

  it('STOP-5: gap directions — leading down, middle both, trailing up', () => {
    // Edits at 41, 75, 140 in a 220-line file (the gaps-small shape).
    const old = genLines(220);
    const next = editLines(old, {
      41: 'edited 41',
      75: 'edited 75',
      140: 'edited 140',
    });
    const gaps = gapStops(stops(old, next));
    expect(gaps.length).toBe(4);
    expect(gaps[0]?.expandDirection).toBe('down');
    expect(gaps[1]?.expandDirection).toBe('both');
    expect(gaps[2]?.expandDirection).toBe('both');
    expect(gaps[3]?.expandDirection).toBe('up');
  });

  it('STOP-6: a hidden range at the collapse threshold (1 line) renders fully — no gap stop', () => {
    // Edits at 20 and 30 with 4-line context → exactly one hidden line (25).
    const old = genLines(60);
    const next = editLines(old, {
      20: 'edited 20',
      30: 'edited 30',
    });
    const all = stops(old, next);
    const between = gapStops(all).filter((g) => g.addStart > 20 && g.addEnd < 30);
    expect(between).toHaveLength(0);
    expect(lineStops(all).some((s) => s.addLine === 25)).toBe(true);
  });

  it('STOP-6: a 2-line hidden range is the smallest bar', () => {
    // Edits at 40 and 51 with 4-line context → hidden lines 45-46.
    const old = genLines(60);
    const next = editLines(old, {
      40: 'edited 40',
      51: 'edited 51',
    });
    const between = gapStops(stops(old, next)).filter((g) => g.addStart >= 45 && g.addEnd <= 46);
    expect(between).toHaveLength(1);
    expect(between[0]?.lines).toBe(2);
  });

  it('STOP-7: gap ranges cover exactly the hidden lines on both sides', () => {
    const { old, next } = oneEditFile();
    const [leading, trailing] = gapStops(stops(old, next));
    expect(leading).toMatchObject({
      addStart: 1,
      addEnd: 5,
      delStart: 1,
      delEnd: 5,
      lines: 5,
    });
    expect(trailing).toMatchObject({
      addStart: 15,
      addEnd: 20,
      delStart: 15,
      delEnd: 20,
      lines: 6,
    });
  });

  it('STOP-8: no trailing gap when the last hunk reaches EOF', () => {
    const old = genLines(20);
    const next = editLines(old, {
      20: 'edited last line',
    });
    const gaps = gapStops(stops(old, next));
    expect(gaps).toHaveLength(1); // leading only
    expect(gaps[0]?.expandDirection).toBe('down');
  });

  it('STOP-9: countLines ignores a single trailing newline', () => {
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('')).toBe(0);
  });
});

describe('expansion', () => {
  /** gaps-small shape: middle gap between the edits at 41 and 75 (45..71). */
  function middleGapFile() {
    const old = genLines(220);
    const next = editLines(old, {
      41: 'edited 41',
      75: 'edited 75',
      140: 'edited 140',
    });
    return {
      old,
      next,
    };
  }

  it('EXP-1: partial expansion converts revealed lines to stops and shrinks the gap', () => {
    const { old, next } = middleGapFile();
    const collapsed = gapStops(stops(old, next))[1] as GapStop; // 45..71
    const expanded: ExpansionMap = new Map([
      [
        collapsed.expandIndex,
        {
          fromStart: 10,
          fromEnd: 5,
        },
      ],
    ]);
    const all = stops(old, next, 'split', expanded);
    const gap = gapStops(all).find((g) => g.expandIndex === collapsed.expandIndex);
    expect(gap).toMatchObject({
      addStart: collapsed.addStart + 10,
      addEnd: collapsed.addEnd - 5,
      lines: collapsed.lines - 15,
    });
    for (let line = collapsed.addStart; line < collapsed.addStart + 10; line++) {
      expect(stopIndexForSelection(all, line, 'additions')).toBeGreaterThan(-1);
    }
    for (let line = collapsed.addEnd - 4; line <= collapsed.addEnd; line++) {
      expect(stopIndexForSelection(all, line, 'additions')).toBeGreaterThan(-1);
    }
    // The still-hidden middle is not a line stop.
    expect(stopIndexForSelection(all, collapsed.addStart + 12, 'additions')).toBe(-1);
  });

  it('EXP-2: fromStart + fromEnd >= size removes the gap stop entirely', () => {
    const { old, next } = middleGapFile();
    const collapsed = gapStops(stops(old, next))[1] as GapStop;
    const expanded: ExpansionMap = new Map([
      [
        collapsed.expandIndex,
        {
          fromStart: 20,
          fromEnd: collapsed.lines - 20,
        },
      ],
    ]);
    const all = stops(old, next, 'split', expanded);
    expect(gapStops(all).some((g) => g.expandIndex === collapsed.expandIndex)).toBe(false);
    for (let line = collapsed.addStart; line <= collapsed.addEnd; line++) {
      expect(stopIndexForSelection(all, line, 'additions')).toBeGreaterThan(-1);
    }
  });

  it('EXP-5: Infinity reveals the entire range (clamped)', () => {
    const { old, next } = middleGapFile();
    const collapsed = gapStops(stops(old, next))[1] as GapStop;
    const expanded: ExpansionMap = new Map([
      [
        collapsed.expandIndex,
        {
          fromStart: Number.POSITIVE_INFINITY,
          fromEnd: 0,
        },
      ],
    ]);
    const all = stops(old, next, 'split', expanded);
    expect(gapStops(all).some((g) => g.expandIndex === collapsed.expandIndex)).toBe(false);
    expect(stopIndexForSelection(all, collapsed.addEnd, 'additions')).toBeGreaterThan(-1);
  });

  it('EXP-4: the trailing gap ignores fromEnd — it only reveals from the top', () => {
    const { old, next } = middleGapFile();
    const trailing = gapStops(stops(old, next)).at(-1) as GapStop;
    const expanded: ExpansionMap = new Map([
      [
        trailing.expandIndex,
        {
          fromStart: 10,
          fromEnd: 999,
        },
      ],
    ]);
    const all = stops(old, next, 'split', expanded);
    const gap = gapStops(all).find((g) => g.expandIndex === trailing.expandIndex);
    // fromEnd ignored: the gap shrinks only from the top.
    expect(gap).toMatchObject({
      addStart: trailing.addStart + 10,
      addEnd: trailing.addEnd,
      lines: trailing.lines - 10,
    });
    // The last file line stays hidden.
    expect(stopIndexForSelection(all, trailing.addEnd, 'additions')).toBe(-1);
  });
});

describe('cursor resolution helpers', () => {
  it('CUR-3: a selection on a hidden line resolves to its bar', () => {
    const { old, next } = oneEditFile();
    const all = stops(old, next);
    const leading = gapStops(all)[0] as GapStop;
    const index = gapIndexForLine(all, 3, 'additions');
    expect(index).toBe(all.indexOf(leading));
    expect(gapIndexForLine(all, 3, 'deletions')).toBe(all.indexOf(leading));
  });

  it('CUR-4: an unmatched selection resolves to the nearest line stop', () => {
    const { old, next } = oneEditFile();
    const all = stops(old, next);
    // Line 4 is hidden (no line stop); the nearest modeled line is 6.
    const nearest = nearestLineStop(all, 4);
    expect((all[nearest] as LineStop).addLine).toBe(6);
  });

  it('NAV-5: change-block starts are change stops whose predecessor is not a change stop, wrapping', () => {
    const old = genLines(60);
    const next = editLines(old, {
      10: 'edited 10',
      30: 'edited 30',
      50: 'edited 50',
    });
    const all = stops(old, next);
    const starts = all
      .map((stop, index) => ({
        stop,
        index,
      }))
      .filter(
        ({ stop, index }) =>
          stop.kind === 'line' &&
          stop.change &&
          !(all[index - 1]?.kind === 'line' && (all[index - 1] as LineStop).change),
      )
      .map(({ index }) => index);
    expect(starts).toHaveLength(3);
    // Forward from before the first start hits it; from the last it wraps to the first.
    expect(nextChangeIndex(all, 0, 1)).toBe(starts[0] as number);
    expect(nextChangeIndex(all, starts[2] as number, 1)).toBe(starts[0] as number);
    // Backward from the first start wraps to the last.
    expect(nextChangeIndex(all, starts[0] as number, -1)).toBe(starts[2] as number);
  });
});
