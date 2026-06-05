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
  }),
  '--trees-bg-override': 'transparent',
  '--trees-bg-muted-override': 'var(--sidebar-accent)',
  '--trees-fg-override': 'var(--sidebar-foreground)',
  '--trees-fg-muted-override': 'var(--muted-foreground)',
  '--trees-border-color-override': 'var(--sidebar-border)',
  '--trees-accent-override': 'var(--sidebar-primary)',
  '--trees-selected-bg-override': 'var(--sidebar-accent)',
  '--trees-selected-fg-override': 'var(--sidebar-accent-foreground)',
  '--trees-indent-guide-bg-override': 'var(--sidebar-border)',
  // Git status keeps universally meaningful colors regardless of the palette.
  '--trees-git-added-color-override': '#10b981',
  '--trees-git-modified-color-override': '#f59e0b',
  '--trees-git-deleted-color-override': '#ef4444',
  '--trees-git-renamed-color-override': '#3b82f6',
  '--trees-git-untracked-color-override': '#10b981',
  '--trees-git-ignored-color-override': 'var(--muted-foreground)',
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
          file.binary ? 'bin' : `+${file.additions} −${file.deletions}`,
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
        <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
      className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar py-2 text-sidebar-foreground"
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
          {empty ? <div className="px-3 py-4 text-sm text-muted-foreground">No changes</div> : null}
        </>
      ) : (
        <div className="px-3 py-4 text-sm text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}
