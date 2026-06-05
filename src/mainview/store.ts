// Global UI state. Wraps the RPC calls and keeps the current ReviewModel,
// selection, and diff-view preference. Bun-pushed `workingTreeChanged` messages
// trigger an automatic refresh.

import { create } from 'zustand';
import type { CompareSpec, ReviewModel } from '../shared/types';
import { api, onWorkingTreeChanged } from './rpc';

export type DiffStyle = 'split' | 'unified';

interface ReviewState {
  loading: boolean;
  error: string | null;
  model: ReviewModel | null;
  compare: CompareSpec;
  selectedPath: string | null;
  diffStyle: DiffStyle;
  refresh: () => Promise<void>;
  select: (path: string) => void;
  setDiffStyle: (style: DiffStyle) => void;
  approve: (paths: string[]) => Promise<void>;
  unapprove: (paths: string[]) => Promise<void>;
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
        const model = await api.getReview({
          compare: get().compare,
        });
        set({
          model,
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
  };
});
