// Sidebar history tab: the working tree on top, then the recent log. A plain
// click reviews one commit (vs its parent); shift+click selects the range
// between the clicked row and the current selection — the working tree counts
// as the newest row, so commit ⇄ working-tree ranges work too (head = null).
// Both endpoints (and the rows between them) highlight so the selected span
// reads at a glance.

import { FileDiff, GitCommitVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReviewStore } from '../store';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

// Rows are indexed newest-first with the working tree as virtual index -1, so
// span math (“newer end” = smaller index) covers it with no special cases.
const WORKING_ROW = -1;

export function HistoryPanel() {
  const log = useReviewStore((state) => state.log);
  const compare = useReviewStore((state) => state.compare);
  const setCompare = useReviewStore((state) => state.setCompare);

  const indexOfRef = (ref: string) => log.findIndex((commit) => commit.hash === ref || commit.shortHash === ref);

  // The selected span as row indices: [newer end, older end]. A plain working
  // selection anchors at the working row so shift+click can extend from it.
  let spanStart = Number.NaN; // newer end
  let spanEnd = Number.NaN; // older end
  if (compare.kind === 'working') {
    spanStart = spanEnd = WORKING_ROW;
  } else if (compare.kind === 'commit') {
    const index = indexOfRef(compare.ref);
    if (index !== -1) {
      spanStart = spanEnd = index;
    }
  } else {
    // indexOfRef's "not found" (-1) collides with WORKING_ROW, so resolve the
    // working-tree head before consulting the log.
    const older = indexOfRef(compare.base);
    const newer = compare.head === null ? WORKING_ROW : indexOfRef(compare.head);
    const newerFound = compare.head === null || newer !== -1;
    if (older !== -1 && newerFound) {
      spanStart = Math.min(newer, older);
      spanEnd = Math.max(newer, older);
    }
  }
  const hasSpan = !Number.isNaN(spanStart);

  // Range between two row indices (newer may be the working row). Equal rows
  // or a working-tree "base" fall back to the plain selection for that row.
  const selectSpan = (a: number, b: number) => {
    const newer = Math.min(a, b);
    const older = Math.max(a, b);
    if (newer === older || older === WORKING_ROW) {
      void setCompare(
        older === WORKING_ROW
          ? {
              kind: 'working',
            }
          : {
              kind: 'commit',
              ref: log[older].hash,
            },
      );
      return;
    }
    void setCompare({
      kind: 'range',
      base: log[older].hash,
      head: newer === WORKING_ROW ? null : log[newer].hash,
    });
  };

  const onRowClick = (index: number, shiftKey: boolean) => {
    if (shiftKey && hasSpan && index !== spanStart) {
      // Extend from the end of the current selection the click is beyond.
      selectSpan(index < spanStart ? spanEnd : spanStart, index);
      return;
    }
    void setCompare(
      index === WORKING_ROW
        ? {
            kind: 'working',
          }
        : {
            kind: 'commit',
            ref: log[index].hash,
          },
    );
  };

  const rowClasses = (index: number) => {
    const inSpan = hasSpan && index >= spanStart && index <= spanEnd;
    const isEndpoint = index === spanStart || index === spanEnd;
    return cn(
      'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
      inSpan
        ? isEndpoint
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'bg-sidebar-accent/40 text-sidebar-foreground'
        : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
    );
  };

  return (
    <div className="flex flex-col px-2 py-1">
      <button
        type="button"
        onClick={(event) => onRowClick(WORKING_ROW, event.shiftKey)}
        className={rowClasses(WORKING_ROW)}
      >
        {/* Endpoint icons follow the highlighted row's foreground — an accent
            color on top of the row highlight read as inconsistent. */}
        <FileDiff
          className={cn(
            'size-3.5 shrink-0',
            spanStart === WORKING_ROW ? 'text-sidebar-accent-foreground' : 'text-muted-foreground',
          )}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium">Working tree</span>
          <span className="truncate text-[0.65rem] text-muted-foreground">Uncommitted changes</span>
        </span>
      </button>

      <div className="mt-1 flex flex-col">
        {log.map((commit, index) => {
          const isEndpoint = index === spanStart || index === spanEnd;
          return (
            <button
              key={commit.hash}
              type="button"
              title={`${commit.shortHash} · ${commit.authorName}`}
              onClick={(event) => onRowClick(index, event.shiftKey)}
              className={rowClasses(index)}
            >
              <GitCommitVertical
                className={cn(
                  'size-3.5 shrink-0',
                  isEndpoint ? 'text-sidebar-accent-foreground' : 'text-muted-foreground',
                )}
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
