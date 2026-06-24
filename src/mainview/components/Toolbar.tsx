// Floating vertical toolbar on the right edge, Figma-style, in three groups:
// review actions (approve file — right-click for approve-all — and
// copy-for-LLM), view options (split/unified segmented slide, wrap,
// whitespace, font size), then refresh. Repo selection lives in the sidebar
// footer; settings opens from the app menu (Cmd+,).

import {
  ALargeSmall,
  AlignJustify,
  BookOpen,
  BookOpenCheck,
  Check,
  CheckCheck,
  ClipboardCopy,
  Columns2,
  Eye,
  FilePen,
  Pilcrow,
  RefreshCw,
  Undo2,
  WrapText,
} from 'lucide-react';
import { ContextMenu, Popover } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { EDITORS, FONT_SIZE_PRESETS } from '../../shared/config';
import { canPreviewMarkdown } from '../../shared/preview';
import type { EditorId } from '../../shared/types';
import { NO_DRAG_REGION } from '../lib/dragRegion';
import { api } from '../platform';
import { useReviewStore } from '../store';
import { FontSizeStepper } from './FontSizeStepper';
import { Button } from './ui/button';
import { Kbd } from './ui/kbd';
import { Toggle } from './ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

// One square cell in the bar; icons get the larger Figma-ish optical size.
const CELL = "size-9 [&_svg:not([class*='size-'])]:size-[18px]";

// Shared chrome for the bar's popups (context menu, font-size popover).
const POPUP =
  'dark z-50 rounded-lg bg-popover/95 p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0';

/** Wraps a control in a tooltip opening away from the right-edge bar.
 * `keys` renders the control's keyboard shortcut as keycaps after the label. */
function Hint({ label, keys, children }: { label: string; keys?: string[]; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="left"
        className={keys ? 'flex items-center gap-1.5' : undefined}
      >
        {label}
        {keys ? (
          <span className="flex items-center gap-0.5">
            {keys.map((token) => (
              <Kbd
                key={token}
                className="h-4 min-w-4 px-1 text-[0.6rem]"
              >
                {token}
              </Kbd>
            ))}
          </span>
        ) : null}
      </TooltipContent>
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
      label: 'Split',
      icon: <Columns2 />,
    },
    {
      value: 'unified' as const,
      label: 'Unified',
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
          keys={[
            '\\',
          ]}
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

// Font size: clicking cycles the standard presets; right-clicking opens a
// stepper to fine-tune pixel by pixel. The button is a Popover.Anchor (not a
// Trigger) so the cycle click never doubles as a popover toggle.
function FontSizeControl({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const fontSize = useReviewStore((state) => state.fontSize);
  const setFontSize = useReviewStore((state) => state.setFontSize);
  const [open, setOpen] = useState(false);

  const next = FONT_SIZE_PRESETS.find((size) => size > fontSize) ?? FONT_SIZE_PRESETS[0];
  const setOpenAndNotify = (value: boolean) => {
    setOpen(value);
    onOpenChange(value);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={setOpenAndNotify}
    >
      <Hint label={`${fontSize}px → ${next}px`}>
        <Popover.Anchor asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            className={cn(CELL, open && 'bg-muted')}
            aria-label="Font size"
            onClick={() => setFontSize(next)}
            onContextMenu={(event) => {
              event.preventDefault();
              setOpenAndNotify(true);
            }}
          >
            <ALargeSmall />
          </Button>
        </Popover.Anchor>
      </Hint>
      <Popover.Portal>
        <Popover.Content
          side="left"
          sideOffset={10}
          className={cn(POPUP, 'p-2')}
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
  const setRead = useReviewStore((state) => state.setRead);
  const exportReview = useReviewStore((state) => state.exportReview);
  const selectedLines = useReviewStore((state) => state.selectedLines);
  const editorChoice = useReviewStore((state) => state.editor);
  const setEditor = useReviewStore((state) => state.setEditor);
  const loading = useReviewStore((state) => state.loading);
  const preview = useReviewStore((state) => state.preview);
  const togglePreview = useReviewStore((state) => state.togglePreview);
  const [exported, setExported] = useState(false);

  const pendingPaths = model?.unreviewed.map((file) => file.path) ?? [];
  const openComments = comments.filter((comment) => comment.status === 'open').length;
  const editorLabel = EDITORS.find((entry) => entry.id === editorChoice)?.label ?? 'editor';

  // The displayed entry for the selected file (mirrors DiffPane's choice):
  // the staged one only when the user flipped a both-bucket file to it.
  const unstagedEntry = model?.unreviewed.find((file) => file.path === selectedPath) ?? null;
  const stagedEntry = model?.reviewed.find((file) => file.path === selectedPath) ?? null;
  const file = diffSide === 'approved' && stagedEntry ? stagedEntry : (unstagedEntry ?? stagedEntry);

  // Markdown today; other renderable types (SVG, PDF…) may join later.
  const previewable = file !== null && canPreviewMarkdown(file);

  const onExport = async () => {
    try {
      await exportReview();
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch (error) {
      console.error('Copy for LLM failed', error);
    }
  };

  // The bar fades to barely-there at rest so it never hides diff text; it
  // returns on hover/keyboard focus — and stays solid while one of its
  // portaled popups (font popover, approve menu) is open, since the pointer
  // leaves the bar to use them.
  const [openPopups, setOpenPopups] = useState(0);
  const trackPopup = (open: boolean) => setOpenPopups((count) => count + (open ? 1 : -1));

  return (
    <div
      className={cn(
        'absolute top-1/2 right-6 z-40 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl bg-popover/90 p-1.5 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-xl',
        'transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100',
        openPopups > 0 ? 'opacity-100' : 'opacity-25',
        NO_DRAG_REGION,
      )}
    >
      {working ? (
        <ContextMenu.Root onOpenChange={trackPopup}>
          <Hint
            label={file?.staged ? `Unapprove ${file.path}` : `Approve ${file?.path ?? 'file'}`}
            keys={[
              file?.staged ? 'u' : 'a',
            ]}
          >
            <ContextMenu.Trigger asChild>
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
            </ContextMenu.Trigger>
          </Hint>
          <ContextMenu.Portal>
            <ContextMenu.Content className={cn(POPUP, 'min-w-[12rem]')}>
              <ContextMenu.Item
                disabled={pendingPaths.length === 0}
                onSelect={() => approve(pendingPaths)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-muted"
              >
                <CheckCheck className="size-3.5 shrink-0" />
                <span>
                  Approve all {pendingPaths.length} file{pendingPaths.length === 1 ? '' : 's'}
                </span>
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      ) : null}

      {/* Mark read — a lighter pass than approve, available in every mode
          (ref/commit modes have no staging, so this is their only progress
          mark). Binary/deleted files have no readable content to fingerprint. */}
      <Hint
        label={file?.read ? `Mark ${file.path} unread` : `Mark ${file?.path ?? 'file'} read`}
        keys={[
          'm',
        ]}
      >
        <Button
          variant="ghost"
          size="icon-lg"
          className={CELL}
          aria-label={file?.read ? 'Mark file unread' : 'Mark file read'}
          disabled={!file || file.binary || file.status === 'deleted'}
          onClick={() =>
            file
              ? setRead(
                  [
                    file.path,
                  ],
                  !file.read,
                )
              : undefined
          }
        >
          {file?.read ? <BookOpenCheck /> : <BookOpen />}
        </Button>
      </Hint>

      <ContextMenu.Root onOpenChange={trackPopup}>
        <Hint
          label={
            file
              ? editorChoice === 'open'
                ? `Open ${file.path}`
                : `Open ${file.path} in ${editorLabel}`
              : 'Open in editor'
          }
        >
          <ContextMenu.Trigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              className={CELL}
              aria-label="Open in editor"
              disabled={!file || file.status === 'deleted'}
              onClick={() =>
                file
                  ? void api.openInEditor({
                      path: file.path,
                      line: selectedLines?.end,
                    })
                  : undefined
              }
            >
              <FilePen />
            </Button>
          </ContextMenu.Trigger>
        </Hint>
        <ContextMenu.Portal>
          <ContextMenu.Content className={cn(POPUP, 'min-w-[11rem]')}>
            <ContextMenu.Label className="px-2 py-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
              Open files with
            </ContextMenu.Label>
            <ContextMenu.RadioGroup
              value={editorChoice}
              onValueChange={(value) => setEditor(value as EditorId)}
            >
              {EDITORS.map((entry) => (
                <ContextMenu.RadioItem
                  key={entry.id}
                  value={entry.id}
                  className="relative flex cursor-pointer items-center rounded-md py-1.5 pr-2 pl-7 text-xs outline-none data-[highlighted]:bg-muted"
                >
                  <ContextMenu.ItemIndicator className="absolute left-2">
                    <Check className="size-3.5" />
                  </ContextMenu.ItemIndicator>
                  {entry.label}
                </ContextMenu.RadioItem>
              ))}
            </ContextMenu.RadioGroup>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Hint
        label={exported ? 'Copied!' : `Copy ${openComments} comment${openComments === 1 ? '' : 's'}`}
        keys={[
          '⌘',
          '⇧',
          'E',
        ]}
      >
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

      <div className="my-0.5 h-px w-6 shrink-0 bg-border" />

      <ViewToggle />

      <Hint
        label={preview && previewable ? `Show diff for ${file?.path}` : `Preview ${file?.path ?? 'file'}`}
        keys={[
          'p',
        ]}
      >
        <Toggle
          className={cn(CELL, 'min-w-9 p-0')}
          aria-label="Preview file"
          disabled={!previewable}
          pressed={preview && previewable}
          onPressedChange={() => togglePreview()}
        >
          <Eye />
        </Toggle>
      </Hint>

      <Hint label={lineWrap ? 'Disable line wrap' : 'Wrap lines'}>
        <Toggle
          className={cn(CELL, 'min-w-9 p-0')}
          aria-label="Wrap long lines"
          pressed={lineWrap}
          onPressedChange={setLineWrap}
        >
          <WrapText />
        </Toggle>
      </Hint>

      {/* Pressed = showing whitespace changes; the default (off) hides them. */}
      <Hint
        label={ignoreWhitespace ? 'Show whitespace' : 'Hide whitespace'}
        keys={[
          'w',
        ]}
      >
        <Toggle
          className={cn(CELL, 'min-w-9 p-0')}
          aria-label="Show whitespace"
          pressed={!ignoreWhitespace}
          onPressedChange={(on) => setIgnoreWhitespace(!on)}
        >
          <Pilcrow />
        </Toggle>
      </Hint>

      <FontSizeControl onOpenChange={trackPopup} />

      <div className="my-0.5 h-px w-6 shrink-0 bg-border" />

      <Hint
        label="Refresh"
        keys={[
          'r',
        ]}
      >
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
