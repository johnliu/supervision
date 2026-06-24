// Global UI state. Wraps the RPC calls and keeps the current ReviewModel,
// comments, selection, and diff-view preference. Bun-pushed `workingTreeChanged`
// messages trigger an automatic refresh.

import type { SelectedLineRange } from '@pierre/diffs/react';
import { create } from 'zustand';
import { CONFIG_DEFAULTS, clampFontSize } from '../shared/config';
import { canPreviewMarkdown } from '../shared/preview';
import type {
  AnnotationSide,
  Comment,
  CommitDetails,
  CommitInfo,
  CompareSpec,
  DiffThemeId,
  EditorId,
  FileChange,
  PaletteId,
  RepoInfo,
  ReviewModel,
  SetRepoResult,
  ThemePreference,
} from '../shared/types';
import { api, onMenuAction, onRepoChanged, onWorkingTreeChanged, sendMenuState } from './platform';

export type DiffStyle = 'split' | 'unified';

/** Which entry of a file that is BOTH staged and unstaged is displayed. */
export type DiffSide = 'new' | 'approved';

/** An in-progress comment: the line (or range) the composer is anchored to. */
export interface Draft {
  path: string;
  line: number;
  side: AnnotationSide;
  endLine?: number;
  endSide?: AnnotationSide;
}

/** A one-shot "scroll the diff here" request (jump-to-comment, find-bar jump). */
export interface ScrollTarget {
  path: string;
  line: number;
  side: AnnotationSide;
}

/** One displayed diff row, with the text to search and the coordinates the
 * CodeView scrolls to. Published by the DiffPane so the find bar can search the
 * whole diff (every shown row, not just the virtualized-into-view ones). */
export interface DiffSearchLine {
  text: string;
  line: number;
  side: AnnotationSide;
}
export interface DiffSearchModel {
  path: string;
  lines: DiffSearchLine[];
}

interface ReviewState {
  loading: boolean;
  error: string | null;
  /** Failed project open (not a git repository) — shown as a modal. */
  repoError: string | null;
  model: ReviewModel | null;
  comments: Comment[];
  compare: CompareSpec;
  selectedPath: string | null;
  /** Staged-vs-unstaged side shown for a file present in both buckets. */
  diffSide: DiffSide;
  /** Render the selected file (markdown today) instead of its diff. Per-file:
   * reset on every selection change. */
  preview: boolean;
  /** Full message of the commit under review (compare.kind === 'commit'). */
  commitDetails: CommitDetails | null;
  /** Commits inside the compared range, newest first (compare.kind === 'range'). */
  rangeCommits: CommitInfo[];
  /** Current line selection in the diff for the selected file (null = none). */
  selectedLines: SelectedLineRange | null;
  /** Open inline comment composer, if any. */
  draft: Draft | null;
  /** Whether the Cmd+K quick-open file switcher is showing. */
  quickOpen: boolean;
  /** Whether the Cmd+F find bar is showing. */
  search: boolean;
  /** Current find-bar query (searches the visible content of any mode). */
  searchQuery: string;
  /** Searchable model of the diff currently shown (null in other modes), so
   * the find bar can search every row, including ones scrolled out of view. */
  diffSearch: DiffSearchModel | null;
  /** Whether the settings panel is showing. */
  settings: boolean;
  /** Whether the keyboard-shortcuts help overlay is showing. */
  shortcuts: boolean;
  /** Whether first-launch onboarding has been completed (persisted). */
  onboarded: boolean;
  /** Whether the onboarding flow is showing. */
  onboarding: boolean;
  diffStyle: DiffStyle;
  ignoreWhitespace: boolean;
  /** Wrap long diff lines instead of scrolling horizontally. */
  lineWrap: boolean;
  /** Diff font size in pixels. */
  fontSize: number;
  /** Where "Open in editor" sends files. */
  editor: EditorId;
  /** Persisted theme preference ('system' follows the OS). */
  theme: ThemePreference;
  /** shadcn base-color family tinting every gray in the UI. */
  palette: PaletteId;
  /** Shiki theme pair the diff highlights with. */
  diffTheme: DiffThemeId;
  /** Live prefers-color-scheme value, kept current by App's media listener. */
  systemDark: boolean;
  /** Recently-opened repo roots, newest first (for the project switcher). */
  recentProjects: string[];
  /** Recent commits, newest first (the sidebar history tab). */
  log: CommitInfo[];
  /** Project / worktree / branch identity (the sidebar footer). */
  repoInfo: RepoInfo | null;
  /** Pending jump-to-comment scroll request, consumed by the DiffPane. */
  scrollTarget: ScrollTarget | null;
  refresh: () => Promise<void>;
  /** Load persisted preferences from `~/.supervision/config.json` on launch. */
  hydrateConfig: () => Promise<void>;
  /** Load the recent-projects list (app-level) on launch. */
  loadRecentProjects: () => Promise<void>;
  /** Switch the repo under review to `path`'s git root (recent click). */
  switchRepo: (path: string) => Promise<void>;
  /** Open the native folder picker, then switch to the chosen repo. */
  openProject: () => Promise<void>;
  /** `git switch` to a local branch in the current worktree (footer menu). */
  switchBranch: (name: string) => Promise<void>;
  /** Show `path`'s diff — or, with null in commit mode, the commit overview. */
  select: (path: string | null) => void;
  setDiffSide: (side: DiffSide) => void;
  /** Toggle the rendered preview for the selected file (no-op when the file
   * has nothing to preview). */
  togglePreview: () => void;
  /** Select the next/previous file in the sidebar order (wraps around). */
  selectNextFile: () => void;
  selectPrevFile: () => void;
  setSelectedLines: (range: SelectedLineRange | null) => void;
  openDraft: (draft: Draft) => void;
  closeDraft: () => void;
  setQuickOpen: (open: boolean) => void;
  setSearch: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setDiffSearch: (model: DiffSearchModel | null) => void;
  /** Request the diff scroll to a line (find-bar jump). */
  setScrollTarget: (target: ScrollTarget | null) => void;
  /** Open the composer for a (single- or multi-line) selection range. */
  commentOnRange: (path: string, range: SelectedLineRange) => void;
  setDiffStyle: (style: DiffStyle) => void;
  setIgnoreWhitespace: (value: boolean) => void;
  setLineWrap: (value: boolean) => void;
  setFontSize: (size: number) => void;
  setEditor: (editor: EditorId) => void;
  setTheme: (theme: ThemePreference) => void;
  setPalette: (palette: PaletteId) => void;
  setDiffTheme: (diffTheme: DiffThemeId) => void;
  setSystemDark: (dark: boolean) => void;
  setSettings: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  /** Dismiss the failed-project-open modal. */
  clearRepoError: () => void;
  /** Mark onboarding finished (or skipped) and persist the flag. */
  completeOnboarding: () => void;
  setCompare: (compare: CompareSpec) => Promise<void>;
  approve: (paths: string[]) => Promise<void>;
  unapprove: (paths: string[]) => Promise<void>;
  /** Mark/unmark files read — a per-file flag separate from approving. Marking
   * advances to the next unread file (like approve); unmarking stays put. */
  setRead: (paths: string[], read: boolean) => Promise<void>;
  addComment: (input: {
    path: string;
    line: number;
    side: AnnotationSide;
    endLine?: number;
    endSide?: AnnotationSide;
    body: string;
  }) => Promise<void>;
  resolveComment: (id: string) => Promise<void>;
  /** Append a reviewer reply to a comment's thread. */
  replyToComment: (id: string, body: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  /** Delete every open or every resolved comment (the panel's "Clear"). */
  clearComments: (status: Comment['status']) => Promise<void>;
  exportReview: () => Promise<{
    markdown: string;
    path: string;
  }>;
  /** Show a comment in the diff: select its file and scroll to its line. */
  jumpToComment: (comment: Comment) => void;
  clearScrollTarget: () => void;
  /** Dispatch a native-menu action id to the matching store action. */
  handleMenuAction: (action: string) => void;
}

function pickSelection(model: ReviewModel, current: string | null, compare: CompareSpec): string | null {
  const paths = [
    ...model.unreviewed,
    ...model.reviewed,
  ].map((file) => file.path);
  if (current && paths.includes(current)) {
    return current;
  }
  // Commit and range modes open on (and fall back to) their details
  // overview — never auto-jump into a file the user didn't pick.
  if (compare.kind !== 'working') {
    return null;
  }
  return model.unreviewed[0]?.path ?? model.reviewed[0]?.path ?? null;
}

/**
 * Files split into the three sidebar groups, with priority Staged > Read >
 * Unread: a path that's staged shows only under Staged (even if it also has
 * unstaged residue or is marked read); the rest of the unstaged bucket splits
 * on the content-addressed `read` flag.
 */
export function partitionFiles(model: ReviewModel): {
  unread: FileChange[];
  read: FileChange[];
  staged: FileChange[];
} {
  const staged = model.reviewed;
  const stagedPaths = new Set(staged.map((file) => file.path));
  const unread: FileChange[] = [];
  const read: FileChange[] = [];
  for (const file of model.unreviewed) {
    if (stagedPaths.has(file.path)) {
      continue;
    }
    (file.read ? read : unread).push(file);
  }
  return {
    unread,
    read,
    staged,
  };
}

/**
 * Next path in `group` (display order) after the acted-on block, wrapping to
 * the first one still left, or null when the group has nothing else.
 */
function nextInGroupAfter(group: string[], actedPaths: string[]): string | null {
  const acted = new Set(actedPaths);
  const startIndex = group.findIndex((path) => acted.has(path));
  const after = group.slice(startIndex + 1).find((path) => !acted.has(path));
  return after ?? group.find((path) => !acted.has(path)) ?? null;
}

/**
 * After acting on `paths` (approve or mark-read), the unread file to advance
 * to: the next still-unread one in display order, wrapping around. Keeps the
 * reviewer moving through files that still need attention — never landing on a
 * file already read or staged.
 */
function nextUnreadAfter(model: ReviewModel, paths: string[]): string | null {
  const unread = partitionFiles(model)
    .unread.map((file) => file.path)
    .sort(compareTreePaths);
  return nextInGroupAfter(unread, paths);
}

/**
 * Tree display order: directories before files, alphabetical within — mirrors
 * the @pierre/trees sidebar so keyboard file-nav steps in the order the user
 * sees, not git's flat path order (which interleaves files and dirs).
 */
function compareTreePaths(a: string, b: string): number {
  const aSegments = a.split('/');
  const bSegments = b.split('/');
  const shared = Math.min(aSegments.length, bSegments.length);
  for (let i = 0; i < shared; i++) {
    if (aSegments[i] !== bSegments[i]) {
      const aIsDir = i < aSegments.length - 1;
      const bIsDir = i < bSegments.length - 1;
      if (aIsDir !== bIsDir) {
        return aIsDir ? -1 : 1;
      }
      return aSegments[i].localeCompare(bSegments[i]);
    }
  }
  return aSegments.length - bSegments.length;
}

/** The concrete palette a preference resolves to ('system' → the OS value). */
export function resolveThemeType(theme: ThemePreference, systemDark: boolean): 'dark' | 'light' {
  if (theme === 'system') {
    return systemDark ? 'dark' : 'light';
  }
  return theme;
}

/** Files in sidebar display order: unread, then read, then staged. */
function orderedPaths(model: ReviewModel): string[] {
  const sorted = (files: FileChange[]) => files.map((file) => file.path).sort(compareTreePaths);
  const { unread, read, staged } = partitionFiles(model);
  return [
    ...sorted(unread),
    ...sorted(read),
    ...sorted(staged),
  ];
}

export const useReviewStore = create<ReviewState>((set, get) => {
  onWorkingTreeChanged(() => {
    void get().refresh();
  });

  onMenuAction((action) => {
    get().handleMenuAction(action);
  });

  // A successful repo switch (recent click / Open Project…) is delivered as a
  // push, not the RPC return — the native dialog can outlive the request
  // timeout. Reset everything repo-scoped (selection, composer, comments,
  // compare back to working) and re-hydrate the new repo's config + review.
  // Bun has already repointed currentRepo, so getConfig/getReview read the new
  // root.
  onRepoChanged(({ recents }) => {
    set({
      recentProjects: recents,
      compare: {
        kind: 'working',
      },
      selectedPath: null,
      selectedLines: null,
      draft: null,
      preview: false,
      commitDetails: null,
      rangeCommits: [],
      comments: [],
      log: [],
      repoInfo: null,
      scrollTarget: null,
      error: null,
    });
    void get().hydrateConfig();
    void get().refresh();
  });

  // Persist the current view preferences to ~/.supervision/config.json.
  const persistConfig = () => {
    void api.saveConfig({
      diffStyle: get().diffStyle,
      ignoreWhitespace: get().ignoreWhitespace,
      lineWrap: get().lineWrap,
      fontSize: get().fontSize,
      editor: get().editor,
      theme: get().theme,
      palette: get().palette,
      diffTheme: get().diffTheme,
      onboarded: get().onboarded,
    });
  };

  // Surface a failed switch (not a git repo) as a modal. Success arrives via
  // the onRepoChanged push above; a request that times out waiting on the
  // dialog is harmless because that push still fires.
  const reportSwitchResult = (result: SetRepoResult) => {
    if (!result.ok && !result.cancelled) {
      set({
        repoError: result.error ?? 'Failed to open project',
      });
    }
  };

  return {
    loading: false,
    error: null,
    repoError: null,
    model: null,
    comments: [],
    compare: {
      kind: 'working',
    },
    selectedPath: null,
    diffSide: 'new',
    preview: false,
    commitDetails: null,
    rangeCommits: [],
    selectedLines: null,
    draft: null,
    quickOpen: false,
    search: false,
    searchQuery: '',
    diffSearch: null,
    settings: false,
    shortcuts: false,
    // Assume onboarded until hydrateConfig reads the persisted flag, so the
    // flow never flashes for an already-onboarded user.
    onboarded: true,
    onboarding: false,
    diffStyle: CONFIG_DEFAULTS.diffStyle,
    ignoreWhitespace: CONFIG_DEFAULTS.ignoreWhitespace,
    lineWrap: CONFIG_DEFAULTS.lineWrap,
    fontSize: CONFIG_DEFAULTS.fontSize,
    editor: CONFIG_DEFAULTS.editor,
    theme: CONFIG_DEFAULTS.theme,
    palette: CONFIG_DEFAULTS.palette,
    diffTheme: CONFIG_DEFAULTS.diffTheme,
    // Seeded from matchMedia; App's effect keeps it tracking the OS.
    systemDark: globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
    recentProjects: [],
    log: [],
    repoInfo: null,
    scrollTarget: null,

    refresh: async () => {
      set({
        loading: true,
        error: null,
      });
      const compare = get().compare;
      try {
        const [model, comments, commitDetails, rangeCommits] = await Promise.all([
          api.getReview({
            compare,
            ignoreWhitespace: get().ignoreWhitespace,
          }),
          api.getComments(),
          // The commit message / range log is part of the same render (the
          // details overview), but auxiliary: a backend without these must
          // not fail the review.
          compare.kind === 'commit'
            ? api
                .getCommit({
                  ref: compare.ref,
                })
                .catch(() => null)
            : Promise.resolve(null),
          compare.kind === 'range'
            ? api
                .getRangeLog({
                  base: compare.base,
                  head: compare.head,
                })
                .catch(() => [])
            : Promise.resolve([]),
        ]);
        set({
          model,
          comments,
          commitDetails,
          rangeCommits,
          selectedPath: pickSelection(model, get().selectedPath, compare),
          loading: false,
        });
      } catch (error) {
        set({
          error: String(error),
          loading: false,
        });
      }
      // History and repo identity are auxiliary — a backend without these
      // (or an empty repo) must not fail the review itself.
      try {
        set({
          log: await api.getLog(),
        });
      } catch {
        set({
          log: [],
        });
      }
      try {
        set({
          repoInfo: await api.getRepoInfo(),
        });
      } catch {
        set({
          repoInfo: null,
        });
      }
    },

    select: (path) => {
      set({
        selectedPath: path,
        // A line selection, any open composer, the staged-side choice, the
        // preview toggle, and a pending comment jump all belong to one file;
        // drop them on switch.
        diffSide: 'new',
        preview: false,
        selectedLines: null,
        draft: null,
        scrollTarget: null,
      });
    },

    setDiffSide: (side) => {
      set({
        diffSide: side,
      });
    },

    togglePreview: () => {
      const { model, selectedPath, preview } = get();
      const file = model
        ? [
            ...model.unreviewed,
            ...model.reviewed,
          ].find((entry) => entry.path === selectedPath)
        : undefined;
      if (!file || !canPreviewMarkdown(file)) {
        return;
      }
      set({
        preview: !preview,
      });
    },

    selectNextFile: () => {
      const { model, selectedPath } = get();
      if (!model) {
        return;
      }
      const paths = orderedPaths(model);
      if (paths.length === 0) {
        return;
      }
      const index = selectedPath ? paths.indexOf(selectedPath) : -1;
      get().select(paths[(index + 1) % paths.length]);
    },

    selectPrevFile: () => {
      const { model, selectedPath } = get();
      if (!model) {
        return;
      }
      const paths = orderedPaths(model);
      if (paths.length === 0) {
        return;
      }
      const index = selectedPath ? paths.indexOf(selectedPath) : 0;
      get().select(paths[(index - 1 + paths.length) % paths.length]);
    },

    setSelectedLines: (range) => {
      set({
        selectedLines: range,
      });
    },

    openDraft: (draft) => {
      set({
        draft,
      });
    },

    closeDraft: () => {
      // Closing the composer also clears the selection it was anchored to, so
      // the hover "+" affordance returns for the next line.
      set({
        draft: null,
        selectedLines: null,
      });
    },

    setQuickOpen: (open) => {
      set({
        quickOpen: open,
      });
    },

    setSearch: (open) => {
      set({
        search: open,
      });
    },

    setSearchQuery: (query) => {
      set({
        searchQuery: query,
      });
    },

    setDiffSearch: (model) => {
      set({
        diffSearch: model,
      });
    },

    setScrollTarget: (target) => {
      set({
        scrollTarget: target,
      });
    },

    commentOnRange: (path, range) => {
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);
      const side = (range.side ?? 'additions') as AnnotationSide;
      set({
        draft: {
          path,
          line: start,
          side,
          endLine: end !== start ? end : undefined,
          endSide: end !== start ? ((range.endSide ?? side) as AnnotationSide) : undefined,
        },
      });
    },

    setDiffStyle: (style) => {
      set({
        diffStyle: style,
      });
      persistConfig();
    },

    setIgnoreWhitespace: (value) => {
      set({
        ignoreWhitespace: value,
      });
      persistConfig();
      // The diff is computed server-side now, so the new setting only takes
      // effect on a refetch.
      void get().refresh();
    },

    setLineWrap: (value) => {
      set({
        lineWrap: value,
      });
      persistConfig();
    },

    setFontSize: (size) => {
      set({
        fontSize: clampFontSize(size),
      });
      persistConfig();
    },

    setEditor: (editor) => {
      set({
        editor,
      });
      persistConfig();
    },

    setTheme: (theme) => {
      set({
        theme,
      });
      persistConfig();
    },

    setPalette: (palette) => {
      set({
        palette,
      });
      persistConfig();
    },

    setDiffTheme: (diffTheme) => {
      set({
        diffTheme,
      });
      persistConfig();
    },

    setSystemDark: (dark) => {
      set({
        systemDark: dark,
      });
    },

    setSettings: (open) => {
      set({
        settings: open,
      });
    },

    setShortcuts: (open) => {
      set({
        shortcuts: open,
      });
    },

    clearRepoError: () => {
      set({
        repoError: null,
      });
    },

    completeOnboarding: () => {
      set({
        onboarded: true,
        onboarding: false,
      });
      persistConfig();
    },

    hydrateConfig: async () => {
      try {
        const loaded = await api.getConfig();
        set({
          diffStyle: loaded.diffStyle,
          ignoreWhitespace: loaded.ignoreWhitespace,
          lineWrap: loaded.lineWrap,
          fontSize: loaded.fontSize,
          editor: loaded.editor,
          theme: loaded.theme,
          palette: loaded.palette,
          diffTheme: loaded.diffTheme,
          onboarded: loaded.onboarded,
          // First launch (no config yet): walk through onboarding.
          ...(loaded.onboarded
            ? {}
            : {
                onboarding: true,
              }),
        });
      } catch (error) {
        console.error('Failed to load config', error);
      }
    },

    loadRecentProjects: async () => {
      try {
        set({
          recentProjects: await api.getRecentProjects(),
        });
      } catch (error) {
        console.error('Failed to load recent projects', error);
      }
    },

    switchRepo: async (path) => {
      try {
        reportSwitchResult(
          await api.setRepo({
            path,
          }),
        );
      } catch {
        // Request timed out; the onRepoChanged push will update the UI.
      }
    },

    openProject: async () => {
      try {
        reportSwitchResult(await api.openProject());
      } catch {
        // The native dialog outlived the RPC timeout; the push drives the update.
      }
    },

    switchBranch: async (name) => {
      // The checkout rewrites working-tree files, so the watcher refreshes
      // too; the explicit refresh just gets the footer branch there sooner.
      const result = await api.switchBranch({
        name,
      });
      if (!result.ok) {
        set({
          error: result.error ?? `Failed to switch to ${name}`,
        });
        return;
      }
      await get().refresh();
    },

    setCompare: async (compare) => {
      set({
        compare,
        selectedPath: null,
        preview: false,
      });
      await get().refresh();
    },

    approve: async (paths) => {
      // Compute the advance target from the pre-stage model so we know the
      // unread order before the approved files leave the list.
      const previous = get().model;
      const target = previous ? nextUnreadAfter(previous, paths) : null;
      const model = await api.stage({
        paths,
        ignoreWhitespace: get().ignoreWhitespace,
      });
      const targetExists =
        target !== null &&
        [
          ...model.unreviewed,
          ...model.reviewed,
        ].some((file) => file.path === target);
      set({
        model,
        selectedPath: targetExists ? target : pickSelection(model, get().selectedPath, get().compare),
      });
    },

    unapprove: async (paths) => {
      const model = await api.unstage({
        paths,
        ignoreWhitespace: get().ignoreWhitespace,
      });
      set({
        model,
        selectedPath: pickSelection(model, get().selectedPath, get().compare),
      });
    },

    setRead: async (paths, read) => {
      // Marking advances to the next unread file (computed from the pre-call
      // model, before the file leaves the unread group); unmarking stays put.
      const previous = get().model;
      const target = read && previous ? nextUnreadAfter(previous, paths) : null;
      const model = await api.setRead({
        paths,
        read,
        compare: get().compare,
        ignoreWhitespace: get().ignoreWhitespace,
      });
      const targetExists =
        target !== null &&
        [
          ...model.unreviewed,
          ...model.reviewed,
        ].some((file) => file.path === target);
      set({
        model,
        selectedPath: targetExists ? target : pickSelection(model, get().selectedPath, get().compare),
      });
    },

    addComment: async (input) => {
      const comments = await api.saveComment(input);
      set({
        comments,
      });
    },

    resolveComment: async (id) => {
      const comments = await api.resolveComment({
        id,
      });
      set({
        comments,
      });
    },

    replyToComment: async (id, body) => {
      const comments = await api.replyToComment({
        id,
        body,
      });
      set({
        comments,
      });
    },

    deleteComment: async (id) => {
      const comments = await api.deleteComment({
        id,
      });
      set({
        comments,
      });
    },

    clearComments: async (status) => {
      const comments = await api.clearComments({
        status,
      });
      set({
        comments,
      });
    },

    exportReview: async () => {
      // The Bun side writes the review file and copies it to the system clipboard.
      return api.exportMarkdown();
    },

    jumpToComment: (comment) => {
      // Selection/composer state belongs to the previous file; the scroll
      // target is consumed (and cleared) by the DiffPane once the diff for
      // `comment.path` has mounted. Targets the range end — where the
      // annotation renders.
      set({
        selectedPath: comment.path,
        diffSide: 'new',
        preview: false,
        selectedLines: null,
        draft: null,
        scrollTarget: {
          path: comment.path,
          line: comment.endLine ?? comment.line,
          side: comment.endSide ?? comment.side,
        },
      });
    },

    clearScrollTarget: () => {
      set({
        scrollTarget: null,
      });
    },

    handleMenuAction: (action) => {
      const state = get();
      switch (action) {
        case 'refresh':
          void state.refresh();
          break;
        case 'export':
          // The menu item mirrors the toolbar's disabled state, but the mirror
          // is pushed async — ignore a click that races a comments change.
          if (state.comments.some((comment) => comment.status === 'open')) {
            void state.exportReview();
          }
          break;
        case 'view:split':
          state.setDiffStyle('split');
          break;
        case 'view:unified':
          state.setDiffStyle('unified');
          break;
        case 'view:toggle-whitespace':
          state.setIgnoreWhitespace(!state.ignoreWhitespace);
          break;
        case 'go:next-file':
          state.selectNextFile();
          break;
        case 'go:prev-file':
          state.selectPrevFile();
          break;
        case 'go:quick-open':
          state.setQuickOpen(true);
          break;
        case 'search:open':
          state.setSearch(true);
          break;
        case 'open-project':
          void state.openProject();
          break;
        case 'settings':
          state.setSettings(true);
          break;
        case 'help:shortcuts':
          state.setShortcuts(true);
          break;
      }
    },
  };
});

// Mirror the toolbar copy-button's enabled state into the native menu ("Copy
// Comments for LLM"). Pushed on every transition between zero and some open
// comments; the menu starts disabled on the Bun side, matching the empty store.
let lastExportEnabled = false;
useReviewStore.subscribe((state) => {
  const exportEnabled = state.comments.some((comment) => comment.status === 'open');
  if (exportEnabled !== lastExportEnabled) {
    lastExportEnabled = exportEnabled;
    sendMenuState({
      exportEnabled,
    });
  }
});
