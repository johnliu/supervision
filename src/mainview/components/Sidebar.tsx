// Changed-files sidebar built on @pierre/trees: a real file tree per review
// group (Unstaged / Staged, or "Changed" in ref mode), colored by git status
// with +/- counts as a row decoration, themed dark to match the app.
//
// The two groups live in a single scroll container as collapsible sections
// (Staged starts collapsed). @pierre/trees virtualizes against a measured
// height, so each expanded tree is sized to its exact content height
// (rowCount × item height) — no inner scrollbar, so the sidebar scrolls as one.
// useFileTree builds its model once, so each tree is keyed by its path set and
// remounts when files are added/removed/approved, while the section's open
// state (keyed stably) survives those refreshes.
//
// The sidebar is tabbed: Files (this tree), History (the git panel, which owns
// working/commit/range selection), and Comments (jump list). A footer pinned
// below holds the project switcher plus the review identity: worktree, branch,
// and the current compare target.

import { themeToTreeStyles } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { ChevronRight, FileX2, FolderTree, History, MessageSquare } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { FileChange } from '../../shared/types';
import { NO_DRAG_REGION } from '../lib/dragRegion';
import { partitionFiles, resolveThemeType, useReviewStore } from '../store';
import { CommentsPanel } from './CommentsPanel';
import { HistoryPanel } from './HistoryPanel';
import { RepoIdentity } from './RepoIdentity';

// Matches @pierre/trees' default density itemHeight (model/density.ts).
const ITEM_HEIGHT = 30;

// Explicit `--trees-*-override` colors (highest precedence) — app CSS custom
// properties, so they follow the active palette on their own. Custom
// properties inherit across the shadow boundary, so setting them on the
// container themes every tree inside it.
const TREE_OVERRIDES = {
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
};

// A base derived from a theme object per palette, with the overrides on top.
const TREE_STYLES: Record<'dark' | 'light', CSSProperties> = {
  dark: {
    ...themeToTreeStyles({
      type: 'dark',
    }),
    ...TREE_OVERRIDES,
  } as unknown as CSSProperties,
  light: {
    ...themeToTreeStyles({
      type: 'light',
    }),
    ...TREE_OVERRIDES,
  } as unknown as CSSProperties,
};

// Rows a fully-expanded tree renders: every file plus each distinct ancestor
// directory (matches flattenEmptyDirectories: false + initialExpansion: 'open').
function treeRowCount(files: FileChange[]): number {
  const dirs = new Set<string>();
  for (const file of files) {
    const segments = file.path.split('/');
    segments.pop();
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      dirs.add(prefix);
    }
  }
  return dirs.size + files.length;
}

function ChangedFilesTree({ files }: { files: FileChange[] }) {
  const select = useReviewStore((state) => state.select);
  const selectedPath = useReviewStore((state) => state.selectedPath);

  const { paths, gitStatus } = useMemo(
    () => ({
      paths: files.map((file) => file.path),
      gitStatus: files.map((file) => ({
        path: file.path,
        status: file.status,
      })),
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
    // No +/- count decoration: long filenames truncate it more often than not,
    // and the diff header shows the counts anyway.
  });

  // Reflect store-driven selection changes (keyboard nav, approve→advance) in
  // the tree, which otherwise only updates from its own clicks.
  useEffect(() => {
    const selected = model.getSelectedPaths();
    if (selectedPath && paths.includes(selectedPath)) {
      // Enforce single-select: drop stale selections first. model.select()
      // ADDS to the selection, so without this the tree ends up multi-selected
      // and its onSelectionChange reports the old path as selected[0], reverting
      // the store (the "bouncing" file-nav bug).
      for (const path of selected) {
        if (path !== selectedPath) {
          model.getItem(path)?.deselect();
        }
      }
      if (!selected.includes(selectedPath)) {
        model.getItem(selectedPath)?.select();
      }
      model.scrollToPath(selectedPath, {
        offset: 'nearest',
      });
    } else {
      // Selection lives in another section (or nowhere); clear this tree.
      for (const path of selected) {
        model.getItem(path)?.deselect();
      }
    }
  }, [
    selectedPath,
    paths,
    model,
  ]);

  // Size to exact content height so the tree never scrolls internally; the
  // sidebar container owns the single scrollbar.
  return (
    <FileTree
      model={model}
      className="text-sm"
      style={{
        height: treeRowCount(files) * ITEM_HEIGHT,
      }}
    />
  );
}

function signature(files: FileChange[]): string {
  return files
    .map((file) => file.path)
    .sort()
    .join('\n');
}

// One collapsible group. The section (and its open state) is keyed stably by
// the caller; the inner tree is keyed by its path set so it remounts on refresh
// without collapsing the section.
function Section({ title, files, defaultOpen }: { title: string; files: FileChange[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <span>{title}</span>
        <span className="font-normal text-muted-foreground/60">{files.length}</span>
      </button>
      {open ? (
        <ChangedFilesTree
          key={signature(files)}
          files={files}
        />
      ) : null}
    </div>
  );
}

// The identity rows (project/worktree, branch/compare) live in RepoIdentity.
function SidebarFooter({ onShowHistory }: { onShowHistory: () => void }) {
  return (
    <div className={cn('shrink-0 border-t border-sidebar-border p-2', NO_DRAG_REGION)}>
      <RepoIdentity onShowHistory={onShowHistory} />
    </div>
  );
}

type SidebarTab = 'files' | 'history' | 'comments';

const TABS: Array<{
  id: SidebarTab;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: 'files',
    label: 'Files',
    icon: <FolderTree className="size-3.5 shrink-0" />,
  },
  {
    id: 'history',
    label: 'History',
    icon: <History className="size-3.5 shrink-0" />,
  },
  {
    id: 'comments',
    label: 'Discuss',
    icon: <MessageSquare className="size-3.5 shrink-0" />,
  },
];

function FilesPanel() {
  const model = useReviewStore((state) => state.model);
  const repoOpen = useReviewStore((state) => state.repoOpen);
  const working = useReviewStore((state) => state.compare.kind === 'working');

  if (!repoOpen) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
        <FolderTree className="size-4 opacity-60" />
        <span>No project open</span>
      </div>
    );
  }
  if (!model) {
    return <div className="px-3 py-4 text-sm text-muted-foreground">Loading…</div>;
  }
  // Three disjoint groups (Staged > Read > Unread); see store.partitionFiles.
  const { unread, read, staged } = partitionFiles(model);
  const empty = unread.length === 0 && read.length === 0 && staged.length === 0;
  // Once anything is read, "Unread" labels the remaining group better than the
  // staging/ref-mode default; with nothing read, keep the familiar title.
  const unreadTitle = read.length > 0 ? 'Unread' : working ? 'Unstaged' : 'Changed';
  return (
    <>
      {unread.length > 0 ? (
        <Section
          key="unread"
          title={unreadTitle}
          files={unread}
          defaultOpen
        />
      ) : null}
      {/* Read shows in every mode — in ref/commit modes it's the only progress
          bucket (there's no staging there). */}
      {read.length > 0 ? (
        <Section
          key="read"
          title="Read"
          files={read}
          defaultOpen={false}
        />
      ) : null}
      {working && staged.length > 0 ? (
        <Section
          key="reviewed"
          title="Staged"
          files={staged}
          defaultOpen={false}
        />
      ) : null}
      {/* Same empty-state treatment as the Discuss tab (CommentsPanel). */}
      {empty ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
          <FileX2 className="size-4 opacity-60" />
          <span>No changes</span>
        </div>
      ) : null}
    </>
  );
}

export function Sidebar() {
  const [tab, setTab] = useState<SidebarTab>('files');
  const themeType = useReviewStore((state) => resolveThemeType(state.theme, state.systemDark));

  return (
    <div
      // The window background IS the sidebar surface (inset-card shell), so
      // the sidebar itself paints nothing and needs no dividing border.
      className="flex h-full w-72 shrink-0 flex-col text-sidebar-foreground"
      style={TREE_STYLES[themeType]}
    >
      {/* Desktop: start below the hiddenInset traffic lights. The empty band
          above this bar (the mt-9 clearance) stays draggable — it's the
          window's title-bar area; the bar itself is a no-drag control. */}
      <div
        className={cn(
          'mx-2 mt-2 flex shrink-0 gap-0.5 rounded-lg bg-muted/40 p-1 [.platform-desktop_&]:mt-9',
          NO_DRAG_REGION,
        )}
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors',
              tab === entry.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto py-2', NO_DRAG_REGION)}>
        {tab === 'files' ? <FilesPanel /> : null}
        {tab === 'history' ? <HistoryPanel /> : null}
        {tab === 'comments' ? <CommentsPanel /> : null}
      </div>

      <SidebarFooter onShowHistory={() => setTab('history')} />
    </div>
  );
}
