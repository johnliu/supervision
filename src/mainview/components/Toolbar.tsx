// Top toolbar: repo + compare selector on the left; icon actions on the right
// (split/unified toggle, ignore-whitespace, copy-for-LLM, approve-all,
// refresh), each with a tooltip explaining what it does.

import { AlignJustify, CheckCheck, ClipboardCopy, Columns2, Pilcrow, RefreshCw, Settings } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useReviewStore } from '../store';
import { CompareSelector } from './CompareSelector';
import { ProjectSwitcher } from './ProjectSwitcher';
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
  const setSettings = useReviewStore((state) => state.setSettings);
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
      <ProjectSwitcher />

      <div className="ml-auto flex items-center gap-2">
        <Hint label={diffStyle === 'split' ? 'Switch to unified view' : 'Switch to split view'}>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={diffStyle === 'split' ? 'Switch to unified view' : 'Switch to split view'}
            onClick={() => setDiffStyle(diffStyle === 'split' ? 'unified' : 'split')}
          >
            {diffStyle === 'split' ? <Columns2 /> : <AlignJustify />}
          </Button>
        </Hint>

        <Hint label={ignoreWhitespace ? 'Ignoring whitespace changes' : 'Showing whitespace changes'}>
          <Toggle
            variant="outline"
            size="sm"
            aria-label="Ignore whitespace"
            pressed={ignoreWhitespace}
            onPressedChange={setIgnoreWhitespace}
          >
            <Pilcrow />
          </Toggle>
        </Hint>

        <Hint
          label={exported ? 'Copied!' : `Copy ${openComments} open comment${openComments === 1 ? '' : 's'} for LLM`}
        >
          <Button
            variant="outline"
            size="icon-sm"
            className="relative"
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
              variant="outline"
              size="icon-sm"
              disabled={pendingPaths.length === 0}
              onClick={() => approve(pendingPaths)}
            >
              <CheckCheck />
            </Button>
          </Hint>
        ) : null}

        <Hint label="Refresh">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => refresh()}
          >
            <RefreshCw className={loading ? 'animate-spin' : undefined} />
          </Button>
        </Hint>

        <Hint label="Settings">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setSettings(true)}
          >
            <Settings />
          </Button>
        </Hint>
      </div>
    </div>
  );
}
