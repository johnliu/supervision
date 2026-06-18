// Pure builders for fixture file contents and FileChange entries. Shared by
// the web fixtures and the diffNav unit tests, so the diffs tests run against
// are exactly the diffs the e2e fixtures render — they cannot drift.

import { parseDiffFromFile } from '@pierre/diffs';
import { createTwoFilesPatch } from 'diff';
import type { FileChange, FileStatus } from '../../../shared/types';

/** `count` numbered lines: "<prefix> N: <filler>". 1-based numbering. */
export function genLines(count: number, prefix = 'line'): string[] {
  return Array.from(
    {
      length: count,
    },
    (_, i) => `${prefix} ${i + 1}: const value${i + 1} = compute(${i + 1});`,
  );
}

/** Contents string with a trailing newline (matching files on disk). */
export function joinContents(lines: string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** Replace 1-based line numbers with new text. */
export function editLines(lines: string[], edits: Record<number, string>): string[] {
  return lines.map((line, i) => edits[i + 1] ?? line);
}

/** Insert `added` after 1-based line `afterLine` (0 = prepend). */
export function insertAfter(lines: string[], afterLine: number, added: string[]): string[] {
  return [
    ...lines.slice(0, afterLine),
    ...added,
    ...lines.slice(afterLine),
  ];
}

/** Remove the 1-based inclusive range. */
export function removeRange(lines: string[], start: number, end: number): string[] {
  return [
    ...lines.slice(0, start - 1),
    ...lines.slice(end),
  ];
}

/** Count true +/- lines the way the diff does (change groups, not hunks). */
function countChanges(
  oldContents: string,
  newContents: string,
  name: string,
): {
  additions: number;
  deletions: number;
} {
  const diff = parseDiffFromFile(
    {
      name,
      contents: oldContents,
    },
    {
      name,
      contents: newContents,
    },
    {},
  );
  let additions = 0;
  let deletions = 0;
  for (const hunk of diff.hunks) {
    for (const group of hunk.hunkContent) {
      if (group.type !== 'context') {
        additions += group.additions;
        deletions += group.deletions;
      }
    }
  }
  return {
    additions,
    deletions,
  };
}

/**
 * A git-style unified diff for the fixture, matching what the bun layer ships
 * from real git. `processFile` parses this (with the contents) the same way the
 * app does, so the demo/e2e exercise the real render path. Empty when there's
 * no textual change (binary, or identical sides).
 */
function makePatch(path: string, oldPath: string, oldContents: string, newContents: string): string {
  if (oldContents === newContents) {
    return '';
  }
  const body = createTwoFilesPatch(`a/${oldPath}`, `b/${path}`, oldContents, newContents, undefined, undefined, {
    context: 3,
  });
  return `diff --git a/${oldPath} b/${path}\n${body}`;
}

export interface MakeFileChangeOptions {
  path: string;
  oldLines: string[];
  newLines: string[];
  status?: FileStatus;
  oldPath?: string;
  staged?: boolean;
  untracked?: boolean;
  binary?: boolean;
}

export function makeFileChange(opts: MakeFileChangeOptions): FileChange {
  const oldContents = opts.binary ? '' : joinContents(opts.oldLines);
  const newContents = opts.binary ? '' : joinContents(opts.newLines);
  const counts = opts.binary
    ? {
        additions: 0,
        deletions: 0,
      }
    : countChanges(oldContents, newContents, opts.path);
  return {
    path: opts.path,
    ...(opts.oldPath
      ? {
          oldPath: opts.oldPath,
        }
      : {}),
    status: opts.status ?? 'modified',
    oldContents,
    newContents,
    patch: opts.binary ? '' : makePatch(opts.path, opts.oldPath ?? opts.path, oldContents, newContents),
    additions: counts.additions,
    deletions: counts.deletions,
    binary: opts.binary ?? false,
    staged: opts.staged ?? false,
    untracked: opts.untracked ?? false,
  };
}
