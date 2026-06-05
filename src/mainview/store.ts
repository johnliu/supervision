// Global UI state. Wraps the RPC calls and keeps the current ReviewModel,
// comments, selection, and diff-view preference. Bun-pushed `workingTreeChanged`
// messages trigger an automatic refresh.

import { create } from 'zustand';
import type { AnnotationSide, Comment, CompareSpec, ReviewModel } from '../shared/types';
import { api, onWorkingTreeChanged } from './rpc';

export type DiffStyle = 'split' | 'unified';

interface ReviewState {
  loading: boolean;
  error: string | null;
  model: ReviewModel | null;
  comments: Comment[];
  compare: CompareSpec;
  selectedPath: string | null;
  diffStyle: DiffStyle;
  refresh: () => Promise<void>;
  select: (path: string) => void;
  setDiffStyle: (style: DiffStyle) => void;
  setCompare: (compare: CompareSpec) => Promise<void>;
  approve: (paths: string[]) => Promise<void>;
  unapprove: (paths: string[]) => Promise<void>;
  addComment: (input: { path: string; line: number; side: AnnotationSide; body: string }) => Promise<void>;
  resolveComment: (id: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  exportReview: () => Promise<{
    markdown: string;
    path: string;
  }>;
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

export const useReviewStore = create<ReviewState>((set, get) => {
  onWorkingTreeChanged(() => {
    void get().refresh();
  });

  return {
    loading: false,
    error: null,
    model: null,
    comments: [],
    compare: {
      kind: 'working',
    },
    selectedPath: null,
    diffStyle: 'split',

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
    },

    select: (path) => {
      set({
        selectedPath: path,
      });
    },

    setDiffStyle: (style) => {
      set({
        diffStyle: style,
      });
    },

    setCompare: async (compare) => {
      set({
        compare,
        selectedPath: null,
      });
      await get().refresh();
    },

    approve: async (paths) => {
      const model = await api.stage({
        paths,
      });
      set({
        model,
        selectedPath: pickSelection(model, get().selectedPath),
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
  };
});
