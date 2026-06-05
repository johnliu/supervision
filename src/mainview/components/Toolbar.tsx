// Top toolbar: shows the repo, toggles unified/split, refreshes, approves all
// pending files, and exports open comments for the LLM (clipboard + file).

import { useState } from 'react';
import { useReviewStore } from '../store';
import { CompareSelector } from './CompareSelector';

export function Toolbar() {
  const model = useReviewStore((state) => state.model);
  const comments = useReviewStore((state) => state.comments);
  const compare = useReviewStore((state) => state.compare);
  const diffStyle = useReviewStore((state) => state.diffStyle);
  const setDiffStyle = useReviewStore((state) => state.setDiffStyle);
  const refresh = useReviewStore((state) => state.refresh);
  const approve = useReviewStore((state) => state.approve);
  const exportReview = useReviewStore((state) => state.exportReview);
  const loading = useReviewStore((state) => state.loading);
  const [exported, setExported] = useState(false);

  const pendingPaths = model?.unreviewed.map((file) => file.path) ?? [];
  const openComments = comments.filter((comment) => comment.status === 'open').length;

  const onExport = async () => {
    try {
      await exportReview();
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch (error) {
      console.error('Copy for LLM failed', error);
    }
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-3">
      <span className="text-sm font-semibold text-neutral-100">Supervision</span>
      <CompareSelector />
      <span className="min-w-0 truncate text-xs text-neutral-500">{model?.repoRoot ?? ''}</span>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex overflow-hidden rounded border border-neutral-700 text-xs">
          <button
            type="button"
            className={`px-2 py-1 ${diffStyle === 'split' ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400'}`}
            onClick={() => setDiffStyle('split')}
          >
            Split
          </button>
          <button
            type="button"
            className={`px-2 py-1 ${diffStyle === 'unified' ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400'}`}
            onClick={() => setDiffStyle('unified')}
          >
            Unified
          </button>
        </div>

        <button
          type="button"
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          disabled={openComments === 0}
          onClick={onExport}
        >
          {exported ? 'Copied!' : `Copy for LLM (${openComments})`}
        </button>

        {compare.kind === 'working' ? (
          <button
            type="button"
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            disabled={pendingPaths.length === 0}
            onClick={() => approve(pendingPaths)}
          >
            Approve all
          </button>
        ) : null}

        <button
          type="button"
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          onClick={() => refresh()}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
