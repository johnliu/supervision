// Changed-files sidebar built on @pierre/trees: a real file tree per review
// group (Needs review / Reviewed), colored by git status, with +/- counts as a
// row decoration. Approve/Unapprove lives on the diff header (tree rows can't
// host React controls). useFileTree builds its model once, so each tree is
// keyed by its path set and remounts when files are added/removed/approved.

import { FileTree, useFileTree } from '@pierre/trees/react';
import { useMemo } from 'react';
import type { FileChange } from '../../shared/types';
import { useReviewStore } from '../store';

/** Number of rows a fully expanded tree of these paths will show (files + dirs). */
function rowCount(paths: string[]): number {
  const dirs = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      dirs.add(segments.slice(0, i).join('/'));
    }
  }
  return paths.length + dirs.size;
}

function ChangedFilesTree({ title, files }: { title: string; files: FileChange[] }) {
  const select = useReviewStore((state) => state.select);
  const selectedPath = useReviewStore((state) => state.selectedPath);

  const { paths, gitStatus, counts } = useMemo(
    () => ({
      paths: files.map((file) => file.path),
      gitStatus: files.map((file) => ({
        path: file.path,
        status: file.status,
      })),
      counts: new Map(
        files.map((file) => [
          file.path,
          `+${file.additions} −${file.deletions}`,
        ]),
      ),
    }),
    [
      files,
    ],
  );

  const { model } = useFileTree({
    paths,
    gitStatus,
    flattenEmptyDirectories: false,
    initialExpansion: 'open',
    initialVisibleRowCount: Math.min(rowCount(paths), 25),
    initialSelectedPaths:
      selectedPath && paths.includes(selectedPath)
        ? [
            selectedPath,
          ]
        : undefined,
    onSelectionChange: (selected) => {
      if (selected[0]) {
        select(selected[0]);
      }
    },
    renderRowDecoration: ({ row }) =>
      row.kind === 'file'
        ? {
            text: counts.get(row.path) ?? '',
          }
        : null,
  });

  return (
    <FileTree
      model={model}
      className="shrink-0 text-sm text-neutral-200"
      header={
        <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {title} ({files.length})
        </div>
      }
    />
  );
}

function signature(files: FileChange[]): string {
  return files
    .map((file) => file.path)
    .sort()
    .join('\n');
}

export function Sidebar() {
  const model = useReviewStore((state) => state.model);
  const working = useReviewStore((state) => state.compare.kind === 'working');

  const empty = model && model.unreviewed.length === 0 && model.reviewed.length === 0;

  return (
    <div className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-r border-neutral-800 bg-neutral-950 py-2">
      {model ? (
        <>
          {model.unreviewed.length > 0 ? (
            <ChangedFilesTree
              key={`unreviewed:${signature(model.unreviewed)}`}
              title={working ? 'Needs review' : 'Changed'}
              files={model.unreviewed}
            />
          ) : null}
          {working && model.reviewed.length > 0 ? (
            <ChangedFilesTree
              key={`reviewed:${signature(model.reviewed)}`}
              title="Reviewed"
              files={model.reviewed}
            />
          ) : null}
          {empty ? <div className="px-3 py-4 text-sm text-neutral-500">No changes</div> : null}
        </>
      ) : (
        <div className="px-3 py-4 text-sm text-neutral-500">Loading…</div>
      )}
    </div>
  );
}
