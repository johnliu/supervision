// Floating action bar centered at the bottom of the window, like a design
// tool's toolbar: view toggle, ignore-whitespace, copy-for-LLM, approve-all
// (working mode), refresh. Repo + compare selection live in the sidebar
// footer; settings opens from the application menu (Cmd+,).

import { AlignJustify, CheckCheck, ClipboardCopy, Columns2, Pilcrow, RefreshCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useReviewStore } from '../store';
import { Button } from './ui/button';
import { Toggle } from './ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** Wraps a control in a tooltip; the control becomes the tooltip trigger. */
function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Toolbar() {
  const model = useReviewStore((state) => state.model);
  const comments = useReviewStore((state) => state.comments);
  const compare = useReviewStore((state) => state.compare);
  const diffStyle = useReviewStore((state) => state.diffStyle);
  const setDiffStyle = useReviewStore((state) => state.setDiffStyle);
  const ignoreWhitespace = useReviewStore((state) => state.ignoreWhitespace);
  const setIgnoreWhitespace = useReviewStore((state) => state.setIgnoreWhitespace);
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
    <div className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-popover/90 p-1.5 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-xl">
      <Hint label={diffStyle === 'split' ? 'Switch to unified view' : 'Switch to split view'}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={diffStyle === 'split' ? 'Switch to unified view' : 'Switch to split view'}
          onClick={() => setDiffStyle(diffStyle === 'split' ? 'unified' : 'split')}
        >
          {diffStyle === 'split' ? <Columns2 /> : <AlignJustify />}
        </Button>
      </Hint>

      <Hint label={ignoreWhitespace ? 'Ignoring whitespace changes' : 'Showing whitespace changes'}>
        <Toggle
          size="default"
          className="size-7 min-w-7 p-0"
          aria-label="Ignore whitespace"
          pressed={ignoreWhitespace}
          onPressedChange={setIgnoreWhitespace}
        >
          <Pilcrow />
        </Toggle>
      </Hint>

      <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />

      <Hint label={exported ? 'Copied!' : `Copy ${openComments} open comment${openComments === 1 ? '' : 's'} for LLM`}>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Copy comments for LLM"
          disabled={openComments === 0}
          onClick={onExport}
        >
          <ClipboardCopy />
          {openComments > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[0.5rem] font-semibold text-primary-foreground">
              {openComments}
            </span>
          ) : null}
        </Button>
      </Hint>

      {compare.kind === 'working' ? (
        <Hint label={`Approve all ${pendingPaths.length} unstaged file${pendingPaths.length === 1 ? '' : 's'}`}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Approve all unstaged files"
            disabled={pendingPaths.length === 0}
            onClick={() => approve(pendingPaths)}
          >
            <CheckCheck />
          </Button>
        </Hint>
      ) : null}

      <Hint label="Refresh">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh"
          onClick={() => refresh()}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
        </Button>
      </Hint>
    </div>
  );
}
