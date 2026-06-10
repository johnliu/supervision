// Stop-model edge cases in one 60-line file:
//   - a change at line 1 (no leading bar)
//   - adjacent del-only / add-only / replace groups near line 10 (one hunk,
//     several change groups — block-start boundaries inside a hunk)
//   - two blocks separated by exactly ONE hidden line (collapse threshold —
//     renders fully, no bar): edits at 20 and 28 with 3-line context
//   - two blocks separated by exactly TWO hidden lines (the smallest bar):
//     edits at 40 and 49
//   - a change on the last line (no trailing bar)

import { editLines, genLines, insertAfter, makeFileChange, removeRange } from './builders';
import type { FixtureData } from './types';

export function edgeBlocks(): FixtureData {
  const old = genLines(60, 'edge');
  // Apply 1-based edits on the OLD numbering first, then structural ops from
  // the bottom up so earlier indices stay valid.
  let next = editLines(old, {
    1: 'edge 1: const value1 = compute(1 * 2); // edited first line',
    14: 'edge 14: const value14 = recompute(14); // replaced',
    20: 'edge 20: const value20 = compute(20 * 2); // edited',
    28: 'edge 28: const value28 = compute(28 * 2); // edited',
    40: 'edge 40: const value40 = compute(40 * 2); // edited',
    49: 'edge 49: const value49 = compute(49 * 2); // edited',
    60: 'edge 60: const value60 = compute(60 * 2); // edited last line',
  });
  next = insertAfter(next, 12, [
    'edge 12.5: const inserted = compute(0); // add-only group',
  ]);
  next = removeRange(next, 10, 10); // del-only group (old line 10)
  return {
    id: 'edge-blocks',
    model: {
      repoRoot: 'fixture://edge-blocks',
      compare: {
        kind: 'working',
      },
      reviewed: [],
      unreviewed: [
        makeFileChange({
          path: 'src/edge-blocks.ts',
          oldLines: old,
          newLines: next,
        }),
      ],
    },
    comments: [],
    config: {
      diffStyle: 'split',
      ignoreWhitespace: false,
    },
  };
}
