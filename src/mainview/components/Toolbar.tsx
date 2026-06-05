// Top toolbar: shows the repo, toggles unified/split, refreshes, approves all
// pending files, and exports open comments for the LLM (clipboard + file).

import { useState } from 'react';
import { useReviewStore } from '../store';
import { CompareSelector } from './CompareSelector';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

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
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3">
      <span className="font-heading text-sm font-semibold">Supervision</span>
      <CompareSelector />
      <span className="min-w-0 truncate text-xs text-muted-foreground">{model?.repoRoot ?? ''}</span>

      <div className="ml-auto flex items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={diffStyle}
          onValueChange={(value) => {
            if (value === 'split' || value === 'unified') {
              setDiffStyle(value);
            }
          }}
        >
          <ToggleGroupItem value="split">Split</ToggleGroupItem>
          <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
        </ToggleGroup>

        <Button
          variant="outline"
          size="sm"
          disabled={openComments === 0}
          onClick={onExport}
        >
          {exported ? 'Copied!' : `Copy for LLM (${openComments})`}
        </Button>

        {compare.kind === 'working' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pendingPaths.length === 0}
            onClick={() => approve(pendingPaths)}
          >
            Approve all
          </Button>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh()}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
    </div>
  );
}
