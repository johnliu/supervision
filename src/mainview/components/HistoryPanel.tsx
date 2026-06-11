// Sidebar history tab: the working tree on top, then the recent log. A plain
// click reviews one commit (vs its parent); shift+click selects the range
// between the clicked commit and the current selection. Both endpoints (and
// the rows between them) highlight so the selected span reads at a glance.

import { FileDiff, GitCommitVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommitInfo } from '../../shared/types';
import { useReviewStore } from '../store';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

export function HistoryPanel() {
  const log = useReviewStore((state) => state.log);
  const compare = useReviewStore((state) => state.compare);
  const setCompare = useReviewStore((state) => state.setCompare);

  const indexOfRef = (ref: string) => log.findIndex((commit) => commit.hash === ref || commit.shortHash === ref);

  // The highlighted span, as log indices (newest first): a single selected
  // commit is a one-row span; a range spans head (newer) → base (older).
  let spanStart = -1; // newer end
  let spanEnd = -1; // older end
  if (compare.kind === 'commit') {
    spanStart = spanEnd = indexOfRef(compare.ref);
  } else if (compare.kind === 'range') {
    const head = indexOfRef(compare.head);
    const base = indexOfRef(compare.base);
    if (head !== -1 && base !== -1) {
      spanStart = Math.min(head, base);
      spanEnd = Math.max(head, base);
    }
  }

  const onCommitClick = (commit: CommitInfo, index: number, shiftKey: boolean) => {
    // Shift extends from the newer end of the current selection; without a
    // commit selection (working tree) shift behaves like a plain click.
    if (shiftKey && spanStart !== -1 && index !== spanStart) {
      const [newer, older] =
        index < spanStart
          ? [
              index,
              spanEnd,
            ]
          : [
              spanStart,
              index,
            ];
      void setCompare({
        kind: 'range',
        base: log[older].hash,
        head: log[newer].hash,
      });
      return;
    }
    void setCompare({
      kind: 'commit',
      ref: commit.hash,
    });
  };

  return (
    <div className="flex flex-col px-2 py-1">
      <button
        type="button"
        onClick={() =>
          void setCompare({
            kind: 'working',
          })
        }
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          compare.kind === 'working'
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
        )}
      >
        <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium">Working tree</span>
          <span className="truncate text-[0.65rem] text-muted-foreground">Uncommitted changes</span>
        </span>
      </button>

      <div className="mt-1 flex flex-col">
        {log.map((commit, index) => {
          const inSpan = spanStart !== -1 && index >= spanStart && index <= spanEnd;
          const isEndpoint = index === spanStart || index === spanEnd;
          return (
            <button
              key={commit.hash}
              type="button"
              title={`${commit.shortHash} · ${commit.authorName}`}
              onClick={(event) => onCommitClick(commit, index, event.shiftKey)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                inSpan
                  ? isEndpoint
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'bg-sidebar-accent/40 text-sidebar-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
              )}
            >
              <GitCommitVertical
                className={cn('size-3.5 shrink-0', isEndpoint ? 'text-sidebar-primary' : 'text-muted-foreground')}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs">{commit.subject}</span>
                <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
                  {commit.shortHash} · {formatDate(commit.authorDate)}
                </span>
              </span>
            </button>
          );
        })}
        {log.length === 0 ? <div className="px-2 py-3 text-xs text-muted-foreground">No commits yet</div> : null}
      </div>
    </div>
  );
}
