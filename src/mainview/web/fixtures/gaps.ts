// Gap-focused scenarios, sized around the 100-line expansion chunk.
//
// gaps-small: every hidden range < 100 — a single Enter/click fully reveals
// any bar (EXP-2/9, bar removal).
// gaps-large: leading ~150, middle ~440 and ~300, trailing ~290 — partial and
// repeated expansion, plus Infinity (shift-click / Expand all).

import { editLines, genLines, makeFileChange } from './builders';
import type { FixtureData } from './types';

function edited(line: number, prefix: string): string {
  return `${prefix} ${line}: const value${line} = compute(${line} * 2); // edited`;
}

export function gapsSmall(): FixtureData {
  const old = genLines(220, 'gs');
  const edits = editLines(old, {
    41: edited(41, 'gs'),
    75: edited(75, 'gs'),
    140: edited(140, 'gs'),
  });
  return {
    id: 'gaps-small',
    model: {
      repoRoot: 'fixture://gaps-small',
      compare: {
        kind: 'working',
      },
      reviewed: [],
      unreviewed: [
        makeFileChange({
          path: 'src/gaps-small.ts',
          oldLines: old,
          newLines: edits,
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

export function gapsLarge(): FixtureData {
  const old = genLines(1200, 'gl');
  const edits = editLines(old, {
    155: edited(155, 'gl'),
    600: edited(600, 'gl'),
    905: edited(905, 'gl'),
  });
  return {
    id: 'gaps-large',
    model: {
      repoRoot: 'fixture://gaps-large',
      compare: {
        kind: 'working',
      },
      reviewed: [],
      unreviewed: [
        makeFileChange({
          path: 'src/gaps-large.ts',
          oldLines: old,
          newLines: edits,
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
