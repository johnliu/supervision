// Remaining scenarios: single-sided diffs, the long-file scrolling stress, and
// the same path present in both buckets.

import { editLines, genLines, makeFileChange } from './builders';
import type { FixtureData } from './types';

export function pureAddDelete(): FixtureData {
  return {
    id: 'pure-add-delete',
    model: {
      repoRoot: 'fixture://pure-add-delete',
      compare: {
        kind: 'working',
      },
      reviewed: [],
      unreviewed: [
        makeFileChange({
          path: 'src/brand-new.ts',
          oldLines: [],
          newLines: genLines(120, 'new'),
          status: 'added',
        }),
        makeFileChange({
          path: 'src/removed.ts',
          oldLines: genLines(80, 'gone'),
          newLines: [],
          status: 'deleted',
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

export function longFile(): FixtureData {
  const old = genLines(3000, 'long').map((line, i) =>
    // A sprinkling of very long lines so horizontal scrolling exists (SCR-7).
    (i + 1) % 200 === 0 ? `${line} ${'// padding'.repeat(40)}` : line,
  );
  const edits: Record<number, string> = {};
  for (let block = 0; block < 25; block++) {
    const line = 100 + block * 115;
    edits[line] = `long ${line}: const value${line} = compute(${line} * 2); // edited block ${block}`;
  }
  return {
    id: 'long-file',
    model: {
      repoRoot: 'fixture://long-file',
      compare: {
        kind: 'working',
      },
      reviewed: [],
      unreviewed: [
        makeFileChange({
          path: 'src/long-file.ts',
          oldLines: old,
          newLines: editLines(old, edits),
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

export function stagedBoth(): FixtureData {
  const head = genLines(80, 'both');
  // Staged entry: HEAD -> index (edit at 30 already approved).
  const index = editLines(head, {
    30: 'both 30: const value30 = compute(30 * 2); // staged edit',
  });
  // Unstaged entry: index -> working tree (further edit at 10).
  const working = editLines(index, {
    10: 'both 10: const value10 = compute(10 * 2); // unstaged edit',
  });
  return {
    id: 'staged-both',
    model: {
      repoRoot: 'fixture://staged-both',
      compare: {
        kind: 'working',
      },
      reviewed: [
        makeFileChange({
          path: 'src/both.ts',
          oldLines: head,
          newLines: index,
          staged: true,
        }),
      ],
      unreviewed: [
        makeFileChange({
          path: 'src/both.ts',
          oldLines: index,
          newLines: working,
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
