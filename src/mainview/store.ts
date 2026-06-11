// Global UI state. Wraps the RPC calls and keeps the current ReviewModel,
// comments, selection, and diff-view preference. Bun-pushed `workingTreeChanged`
// messages trigger an automatic refresh.

import type { SelectedLineRange } from '@pierre/diffs/react';
import { create } from 'zustand';
import { CONFIG_DEFAULTS, clampFontSize } from '../shared/config';
import type {
  AnnotationSide,
  Comment,
  CommitInfo,
  CompareSpec,
  FileChange,
  ReviewModel,
  SetRepoResult,
} from '../shared/types';
import { api, onMenuAction, onRepoChanged, onWorkingTreeChanged } from './platform';

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

/** A one-shot "scroll the diff here" request (jump-to-comment). */
export interface ScrollTarget {
  path: string;
  line: number;
  side: AnnotationSide;
}

interface ReviewState {
  loading: boolean;
  error: string | null;
  model: ReviewModel | null;
  comments: Comment[];
  compare: CompareSpec;
  selectedPath: string | null;
  /** Staged-vs-unstaged side shown for a file present in both buckets. */
  diffSide: DiffSide;
  /** Current line selection in the diff for the selected file (null = none). */
  selectedLines: SelectedLineRange | null;
  /** Open inline comment composer, if any. */
  draft: Draft | null;
  /** Whether the Cmd+K quick-open file switcher is showing. */
  quickOpen: boolean;
  /** Whether the settings panel is showing. */
  settings: boolean;
  /** Whether the keyboard-shortcuts help overlay is showing. */
  shortcuts: boolean;
  diffStyle: DiffStyle;
  ignoreWhitespace: boolean;
  /** Wrap long diff lines instead of scrolling horizontally. */
  lineWrap: boolean;
  /** Diff font size in pixels. */
  fontSize: number;
  /** Recently-opened repo roots, newest first (for the project switcher). */
  recentProjects: string[];
  /** Recent commits, newest first (the sidebar history tab). */
  log: CommitInfo[];
  /** Pending jump-to-comment scroll request, consumed by the DiffPane. */
  scrollTarget: ScrollTarget | null;
  refresh: () => Promise<void>;
  /** Load persisted preferences from `.supervision/config.json` on launch. */
  hydrateConfig: () => Promise<void>;
  /** Load the recent-projects list (app-level) on launch. */
  loadRecentProjects: () => Promise<void>;
  /** Switch the repo under review to `path`'s git root (recent click). */
  switchRepo: (path: string) => Promise<void>;
  /** Open the native folder picker, then switch to the chosen repo. */
  openProject: () => Promise<void>;
  select: (path: string) => void;
  setDiffSide: (side: DiffSide) => void;
  /** Select the next/previous file in the sidebar order (wraps around). */
  selectNextFile: () => void;
  selectPrevFile: () => void;
  setSelectedLines: (range: SelectedLineRange | null) => void;
  openDraft: (draft: Draft) => void;
  closeDraft: () => void;
  setQuickOpen: (open: boolean) => void;
  /** Open the composer for a (single- or multi-line) selection range. */
  commentOnRange: (path: string, range: SelectedLineRange) => void;
  setDiffStyle: (style: DiffStyle) => void;
  setIgnoreWhitespace: (value: boolean) => void;
  setLineWrap: (value: boolean) => void;
  setFontSize: (size: number) => void;
  setSettings: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  setCompare: (compare: CompareSpec) => Promise<void>;
  approve: (paths: string[]) => Promise<void>;
  unapprove: (paths: string[]) => Promise<void>;
  addComment: (input: {
    path: string;
    line: number;
    side: AnnotationSide;
    endLine?: number;
    endSide?: AnnotationSide;
    body: string;
  }) => Promise<void>;
  resolveComment: (id: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
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

function pickSelection(model: ReviewModel, current: string | null): string | null {
  const paths = [
    ...model.unreviewed,
    ...model.reviewed,
  ].map((file) => file.path);
  if (current && paths.includes(current)) {
    return current;
  }
  return model.unreviewed[0]?.path ?? model.reviewed[0]?.path ?? null;
}

/**
 * After staging `approvedPaths`, the unstaged file to advance to: the next one
 * after the approved block in display order, wrapping to the first remaining
 * unstaged file, or null when nothing unstaged is left.
 */
function nextUnstagedAfter(model: ReviewModel, approvedPaths: string[]): string | null {
  const approved = new Set(approvedPaths);
  const startIndex = model.unreviewed.findIndex((file) => approved.has(file.path));
  const after = model.unreviewed.slice(startIndex + 1).find((file) => !approved.has(file.path));
  return after?.path ?? model.unreviewed.find((file) => !approved.has(file.path))?.path ?? null;
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

/** Files in sidebar display order: unstaged section first, then staged. */
function orderedPaths(model: ReviewModel): string[] {
  const sorted = (files: FileChange[]) => files.map((file) => file.path).sort(compareTreePaths);
  return [
    ...sorted(model.unreviewed),
    ...sorted(model.reviewed),
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
      comments: [],
      log: [],
      scrollTarget: null,
      error: null,
    });
    void get().hydrateConfig();
    void get().refresh();
  });

  // Persist the current view preferences to .supervision/config.json.
  const persistConfig = () => {
    void api.saveConfig({
      diffStyle: get().diffStyle,
      ignoreWhitespace: get().ignoreWhitespace,
      lineWrap: get().lineWrap,
      fontSize: get().fontSize,
    });
  };

  // Surface a failed switch (not a git repo). Success arrives via the
  // onRepoChanged push above; a request that times out waiting on the dialog is
  // harmless because that push still fires.
  const reportSwitchResult = (result: SetRepoResult) => {
    if (!result.ok && !result.cancelled) {
      set({
        error: result.error ?? 'Failed to open project',
      });
    }
  };

  return {
    loading: false,
    error: null,
    model: null,
    comments: [],
    compare: {
      kind: 'working',
    },
    selectedPath: null,
    diffSide: 'new',
    selectedLines: null,
    draft: null,
    quickOpen: false,
    settings: false,
    shortcuts: false,
    diffStyle: CONFIG_DEFAULTS.diffStyle,
    ignoreWhitespace: CONFIG_DEFAULTS.ignoreWhitespace,
    lineWrap: CONFIG_DEFAULTS.lineWrap,
    fontSize: CONFIG_DEFAULTS.fontSize,
    recentProjects: [],
    log: [],
    scrollTarget: null,

    refresh: async () => {
      set({
        loading: true,
        error: null,
      });
      try {
        const [model, comments] = await Promise.all([
          api.getReview({
            compare: get().compare,
          }),
          api.getComments(),
        ]);
        set({
          model,
          comments,
          selectedPath: pickSelection(model, get().selectedPath),
          loading: false,
        });
      } catch (error) {
        set({
          error: String(error),
          loading: false,
        });
      }
      // History is auxiliary — a backend without getLog (or an empty repo)
      // must not fail the review itself.
      try {
        set({
          log: await api.getLog(),
        });
      } catch {
        set({
          log: [],
        });
      }
    },

    select: (path) => {
      set({
        selectedPath: path,
        // A line selection, any open composer, the staged-side choice, and a
        // pending comment jump all belong to one file; drop them on switch.
        diffSide: 'new',
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

    hydrateConfig: async () => {
      try {
        const loaded = await api.getConfig();
        set({
          diffStyle: loaded.diffStyle,
          ignoreWhitespace: loaded.ignoreWhitespace,
          lineWrap: loaded.lineWrap,
          fontSize: loaded.fontSize,
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

    setCompare: async (compare) => {
      set({
        compare,
        selectedPath: null,
      });
      await get().refresh();
    },

    approve: async (paths) => {
      // Compute the advance target from the pre-stage model so we know the
      // unstaged order before the approved files leave the list.
      const previous = get().model;
      const target = previous ? nextUnstagedAfter(previous, paths) : null;
      const model = await api.stage({
        paths,
      });
      const targetExists =
        target !== null &&
        [
          ...model.unreviewed,
          ...model.reviewed,
        ].some((file) => file.path === target);
      set({
        model,
        selectedPath: targetExists ? target : pickSelection(model, get().selectedPath),
      });
    },

    unapprove: async (paths) => {
      const model = await api.unstage({
        paths,
      });
      set({
        model,
        selectedPath: pickSelection(model, get().selectedPath),
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

    deleteComment: async (id) => {
      const comments = await api.deleteComment({
        id,
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
          void state.exportReview();
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
