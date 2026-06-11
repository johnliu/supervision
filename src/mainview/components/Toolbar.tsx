// Floating vertical toolbar on the right edge, Figma-style: view mode as a
// sliding segmented group, wrap toggle, font-size popover, then the review
// actions (approve file, approve all, copy-for-LLM, refresh). Repo selection
// lives in the sidebar footer; settings opens from the app menu (Cmd+,).

import {
  ALargeSmall,
  AlignJustify,
  Check,
  CheckCheck,
  ClipboardCopy,
  Columns2,
  Pilcrow,
  RefreshCw,
  Undo2,
  WrapText,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { useReviewStore } from '../store';
import { FontSizeStepper } from './FontSizeStepper';
import { Button } from './ui/button';
import { Toggle } from './ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

// One square cell in the bar; icons get the larger Figma-ish optical size.
const CELL = "size-9 [&_svg:not([class*='size-'])]:size-[18px]";

/** Wraps a control in a tooltip opening away from the right-edge bar. */
function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

// Segmented split/unified control: a thumb slides behind the two options so
// the pair reads as one group with one active member.
function ViewToggle() {
  const diffStyle = useReviewStore((state) => state.diffStyle);
  const setDiffStyle = useReviewStore((state) => state.setDiffStyle);
  const options = [
    {
      value: 'split' as const,
      label: 'Split view',
      icon: <Columns2 />,
    },
    {
      value: 'unified' as const,
      label: 'Unified view',
      icon: <AlignJustify />,
    },
  ];
  const index = diffStyle === 'unified' ? 1 : 0;

  return (
    <div className="relative flex flex-col gap-1 rounded-lg bg-muted/40 p-1">
      <div
        aria-hidden
        className="absolute top-1 left-1 size-9 rounded-md bg-background shadow-sm ring-1 ring-foreground/10 transition-transform duration-200 ease-out"
        style={{
          // travel = cell (36px) + gap-1 (4px)
          transform: `translateY(${index * 40}px)`,
        }}
      />
      {options.map((option) => (
        <Hint
          key={option.value}
          label={option.label}
        >
          <button
            type="button"
            aria-label={option.label}
            aria-pressed={diffStyle === option.value}
            onClick={() => setDiffStyle(option.value)}
            className={cn(
              "relative z-10 flex items-center justify-center rounded-md transition-colors [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
              CELL,
              diffStyle === option.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.icon}
          </button>
        </Hint>
      ))}
    </div>
  );
}

// Font size pops out a stepper rather than living inline — a number plus two
// buttons is too wide for a one-cell-wide bar.
function FontSizeControl() {
  const fontSize = useReviewStore((state) => state.fontSize);

  return (
    <Popover.Root>
      <Hint label={`Font size (${fontSize}px)`}>
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            className={cn(CELL, 'aria-expanded:bg-muted')}
            aria-label="Font size"
          >
            <ALargeSmall />
          </Button>
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Content
          side="left"
          sideOffset={10}
          className="dark z-50 rounded-lg bg-popover/95 p-2 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <FontSizeStepper />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Toolbar() {
  const model = useReviewStore((state) => state.model);
  const comments = useReviewStore((state) => state.comments);
  const working = useReviewStore((state) => state.compare.kind === 'working');
  const selectedPath = useReviewStore((state) => state.selectedPath);
  const diffSide = useReviewStore((state) => state.diffSide);
  const lineWrap = useReviewStore((state) => state.lineWrap);
  const setLineWrap = useReviewStore((state) => state.setLineWrap);
  const ignoreWhitespace = useReviewStore((state) => state.ignoreWhitespace);
  const setIgnoreWhitespace = useReviewStore((state) => state.setIgnoreWhitespace);
  const refresh = useReviewStore((state) => state.refresh);
  const approve = useReviewStore((state) => state.approve);
  const unapprove = useReviewStore((state) => state.unapprove);
  const exportReview = useReviewStore((state) => state.exportReview);
  const loading = useReviewStore((state) => state.loading);
  const [exported, setExported] = useState(false);

  const pendingPaths = model?.unreviewed.map((file) => file.path) ?? [];
  const openComments = comments.filter((comment) => comment.status === 'open').length;

  // The displayed entry for the selected file (mirrors DiffPane's choice):
  // the staged one only when the user flipped a both-bucket file to it.
  const unstagedEntry = model?.unreviewed.find((file) => file.path === selectedPath) ?? null;
  const stagedEntry = model?.reviewed.find((file) => file.path === selectedPath) ?? null;
  const file = diffSide === 'approved' && stagedEntry ? stagedEntry : (unstagedEntry ?? stagedEntry);

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
    <div className="absolute top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl bg-popover/90 p-1.5 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-xl">
      <ViewToggle />

      <Hint label={lineWrap ? 'Wrapping long lines' : 'Scrolling long lines'}>
        <Toggle
          className={cn(CELL, 'min-w-9 p-0')}
          aria-label="Wrap long lines"
          pressed={lineWrap}
          onPressedChange={setLineWrap}
        >
          <WrapText />
        </Toggle>
      </Hint>

      <Hint label={ignoreWhitespace ? 'Ignoring whitespace changes' : 'Showing whitespace changes'}>
        <Toggle
          className={cn(CELL, 'min-w-9 p-0')}
          aria-label="Ignore whitespace"
          pressed={ignoreWhitespace}
          onPressedChange={setIgnoreWhitespace}
        >
          <Pilcrow />
        </Toggle>
      </Hint>

      <FontSizeControl />

      <div className="my-0.5 h-px w-6 shrink-0 bg-border" />

      {working ? (
        <Hint label={file?.staged ? `Unapprove ${file.path}` : `Approve ${file?.path ?? 'file'}`}>
          <Button
            variant="ghost"
            size="icon-lg"
            className={CELL}
            aria-label={file?.staged ? 'Unapprove file' : 'Approve file'}
            disabled={!file}
            onClick={() =>
              file
                ? file.staged
                  ? unapprove([
                      file.path,
                    ])
                  : approve([
                      file.path,
                    ])
                : undefined
            }
          >
            {file?.staged ? <Undo2 /> : <Check />}
          </Button>
        </Hint>
      ) : null}

      {working ? (
        <Hint label={`Approve all ${pendingPaths.length} unstaged file${pendingPaths.length === 1 ? '' : 's'}`}>
          <Button
            variant="ghost"
            size="icon-lg"
            className={CELL}
            aria-label="Approve all unstaged files"
            disabled={pendingPaths.length === 0}
            onClick={() => approve(pendingPaths)}
          >
            <CheckCheck />
          </Button>
        </Hint>
      ) : null}

      <Hint label={exported ? 'Copied!' : `Copy ${openComments} open comment${openComments === 1 ? '' : 's'} for LLM`}>
        <Button
          variant="ghost"
          size="icon-lg"
          className={cn(CELL, 'relative')}
          aria-label="Copy comments for LLM"
          disabled={openComments === 0}
          onClick={onExport}
        >
          <ClipboardCopy />
          {openComments > 0 ? (
            <span className="absolute top-0 right-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[0.5rem] font-semibold text-primary-foreground">
              {openComments}
            </span>
          ) : null}
        </Button>
      </Hint>

      <Hint label="Refresh">
        <Button
          variant="ghost"
          size="icon-lg"
          className={CELL}
          aria-label="Refresh"
          onClick={() => refresh()}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
        </Button>
      </Hint>
    </div>
  );
}
