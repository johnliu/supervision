// Default scenario: a small multi-file review exercising the sidebar, file
// statuses, the staged bucket, comments, and the binary placeholder.

import type { Comment } from '../../../shared/types';
import { editLines, genLines, makeFileChange } from './builders';
import type { FixtureData } from './types';

export function basic(): FixtureData {
  const appOld = genLines(200, 'app');
  const appNew = editLines(appOld, {
    10: 'app 10: const value10 = compute(10 * 2); // edited near top',
    100: 'app 100: const value100 = compute(100 + 1); // edited mid-file',
    190: 'app 190: const value190 = recompute(190); // edited near bottom',
  });

  const renamedOld = genLines(50, 'renamed');
  const renamedNew = editLines(renamedOld, {
    25: 'renamed 25: const value25 = compute(25); // touched during rename',
  });

  const stagedOld = genLines(40, 'staged');
  const stagedNew = editLines(stagedOld, {
    20: 'staged 20: const value20 = compute(20); // already approved',
  });

  const comments: Comment[] = [
    {
      id: 'fixture-comment-1',
      path: 'src/app.ts',
      line: 10,
      side: 'additions',
      body: 'Why double here?',
      status: 'open',
      createdAt: '2026-06-01T10:00:00.000Z',
      // A back-and-forth thread, for eyeballing reply rendering in web mode.
      replies: [
        {
          id: 'fixture-reply-1',
          author: 'agent',
          body: 'The sensor reports half-steps, so the raw value is doubled before display.',
          createdAt: '2026-06-01T10:02:00.000Z',
        },
        {
          id: 'fixture-reply-2',
          author: 'user',
          body: 'Then pull the 2 into a named constant.',
          createdAt: '2026-06-01T10:03:00.000Z',
        },
      ],
    },
    {
      id: 'fixture-comment-2',
      path: 'src/app.ts',
      line: 100,
      side: 'additions',
      endLine: 103,
      endSide: 'additions',
      body: 'This whole block needs a bounds check.',
      status: 'open',
      createdAt: '2026-06-01T10:05:00.000Z',
      // The real backend derives `stale` from the anchor on read; the fixture
      // pins both so web mode renders the stale badge.
      anchor: {
        head: '1111111111111111111111111111111111111111',
        blob: '2222222222222222222222222222222222222222',
      },
      stale: true,
    },
    {
      id: 'fixture-comment-3',
      path: 'src/app.ts',
      line: 190,
      side: 'additions',
      body: 'Resolved earlier.',
      status: 'resolved',
      createdAt: '2026-06-01T10:10:00.000Z',
    },
  ];

  return {
    id: 'basic',
    model: {
      repoRoot: 'fixture://basic',
      compare: {
        kind: 'working',
      },
      reviewed: [
        makeFileChange({
          path: 'src/staged.ts',
          oldLines: stagedOld,
          newLines: stagedNew,
          staged: true,
        }),
      ],
      unreviewed: [
        makeFileChange({
          path: 'src/app.ts',
          oldLines: appOld,
          newLines: appNew,
        }),
        makeFileChange({
          path: 'src/new-feature.ts',
          oldLines: [],
          newLines: genLines(60, 'feature'),
          status: 'untracked',
          untracked: true,
        }),
        makeFileChange({
          path: 'src/legacy.ts',
          oldLines: genLines(80, 'legacy'),
          newLines: [],
          status: 'deleted',
        }),
        makeFileChange({
          path: 'src/renamed-new.ts',
          oldPath: 'src/renamed-old.ts',
          oldLines: renamedOld,
          newLines: renamedNew,
          status: 'renamed',
        }),
        makeFileChange({
          path: 'assets/logo.png',
          oldLines: [],
          newLines: [],
          binary: true,
        }),
      ],
    },
    comments,
    config: {
      diffStyle: 'split',
      ignoreWhitespace: false,
    },
  };
}
