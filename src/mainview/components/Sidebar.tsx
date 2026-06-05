// Changed-files sidebar built on @pierre/trees: a real file tree per review
// group (Needs review / Reviewed, or "Changed" in ref mode), colored by git
// status with +/- counts as a row decoration, themed dark to match the app.
// useFileTree builds its model once, so each tree is keyed by its path set and
// remounts when files are added/removed/approved.

import { themeToTreeStyles } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { type CSSProperties, useMemo } from 'react';
import type { FileChange } from '../../shared/types';
import { useReviewStore } from '../store';

// A dark base derived from a theme object, plus explicit `--trees-*-override`
// colors (highest precedence). Custom properties inherit across the shadow
// boundary, so setting them on the container themes every tree inside it.
const TREE_STYLE = {
  ...themeToTreeStyles({
    type: 'dark',
    bg: '#0a0a0a',
    fg: '#e5e5e5',
  }),
  '--trees-bg-override': 'transparent',
  '--trees-bg-muted-override': '#171717',
  '--trees-fg-override': '#e5e5e5',
  '--trees-fg-muted-override': '#737373',
  '--trees-border-color-override': '#262626',
  '--trees-accent-override': '#60a5fa',
  '--trees-selected-bg-override': '#262626',
  '--trees-selected-fg-override': '#f5f5f5',
  '--trees-indent-guide-bg-override': '#262626',
  '--trees-git-added-color-override': '#4ade80',
  '--trees-git-modified-color-override': '#fbbf24',
  '--trees-git-deleted-color-override': '#f87171',
  '--trees-git-renamed-color-override': '#60a5fa',
  '--trees-git-untracked-color-override': '#4ade80',
  '--trees-git-ignored-color-override': '#737373',
} as unknown as CSSProperties;

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

  // flex-1 + min-h-0 gives the tree a real measured height (required by
  // @pierre/trees; initialVisibleRowCount is only a first-render hint).
  return (
    <FileTree
      model={model}
      className="min-h-0 flex-1 text-sm"
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
    <div
      className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-neutral-800 bg-neutral-950 py-2"
      style={TREE_STYLE}
    >
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
