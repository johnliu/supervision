// GitHub-style overviews for ref comparisons, rendered in place of the diff
// pane while no file is selected; clicking a file opens its diff (the
// DiffPane's floating pill returns here).
//
//   CommitDetailsPane — one commit: full message, author/date/hash meta, and
//   the changed-file list with +/- counts (GitHub's commit page).
//
//   RangeDetailsPane — a commit range (shift+click in History): the commits
//   inside base..head oldest-first, then the aggregate changed files
//   (GitHub's compare view). A commit row drills into that commit's own
//   details; the working tree counts as the newer endpoint when head is null.

import { FileDiff, GitCommitVertical, GitCompareArrows } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommitInfo, FileChange, FileStatus } from '../../shared/types';
import { useReviewStore } from '../store';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

function formatDate(format: Intl.DateTimeFormat, iso: string | undefined): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : format.format(date);
}

// Status letters keep the sidebar tree's universally meaningful colors
// (TREE_OVERRIDES in Sidebar.tsx) regardless of the palette.
const STATUS_BADGES: Record<
  FileStatus,
  {
    letter: string;
    color: string;
  }
> = {
  added: {
    letter: 'A',
    color: '#10b981',
  },
  modified: {
    letter: 'M',
    color: '#f59e0b',
  },
  deleted: {
    letter: 'D',
    color: '#ef4444',
  },
  renamed: {
    letter: 'R',
    color: '#3b82f6',
  },
  untracked: {
    letter: 'A',
    color: '#10b981',
  },
};

function FileRow({ file, onSelect }: { file: FileChange; onSelect: () => void }) {
  const badge = STATUS_BADGES[file.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/50"
    >
      <span
        title={file.status}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm text-[0.6rem] font-bold"
        style={{
          color: badge.color,
          backgroundColor: `${badge.color}1f`,
        }}
      >
        {badge.letter}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs">
        {file.oldPath ? (
          <>
            <span className="text-muted-foreground">{file.oldPath} → </span>
            {file.path}
          </>
        ) : (
          file.path
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[0.65rem]">
        {file.binary ? (
          <span className="text-muted-foreground">binary</span>
        ) : (
          <>
            <span className="text-[#10b981]">+{file.additions}</span>
            <span className="text-[#ef4444]">−{file.deletions}</span>
          </>
        )}
      </span>
    </button>
  );
}

/** "N changed files · +x −y" header plus the clickable file list. */
function FilesSection({ files }: { files: FileChange[] }) {
  const select = useReviewStore((state) => state.select);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium">
          {files.length} changed file{files.length === 1 ? '' : 's'}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[0.65rem]">
          <span className="text-[#10b981]">+{additions}</span>
          <span className="text-[#ef4444]">−{deletions}</span>
        </span>
      </div>
      <div className={cn('mt-2 rounded-lg border border-border', files.length > 0 && 'divide-y divide-border')}>
        {files.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No files changed</div>
        ) : (
          files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              onSelect={() => select(file.path)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function CommitDetailsPane() {
  const model = useReviewStore((state) => state.model);
  const details = useReviewStore((state) => state.commitDetails);
  const compare = useReviewStore((state) => state.compare);
  const log = useReviewStore((state) => state.log);

  const ref = compare.kind === 'commit' ? compare.ref : null;
  // getCommit is auxiliary — when it's unavailable (older backend), fall back
  // to the history panel's own record of the commit.
  const logEntry = ref ? log.find((commit) => commit.hash === ref || commit.shortHash === ref) : undefined;
  const subject = details?.subject ?? logEntry?.subject ?? ref ?? '';
  const shortHash = details?.shortHash ?? logEntry?.shortHash ?? '';
  const authorName = details?.authorName ?? logEntry?.authorName ?? '';
  const authorDate = formatDate(DATE_FORMAT, details?.authorDate ?? logEntry?.authorDate);

  const files = model && model.compare.kind === 'commit' ? model.unreviewed : [];

  return (
    <div
      data-testid="commit-details"
      className="h-full overflow-y-auto bg-background"
    >
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="flex items-start gap-3">
          <GitCommitVertical className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base leading-snug font-semibold break-words">{subject}</h1>
            {details?.body ? (
              <pre className="mt-3 rounded-lg bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                {details.body}
              </pre>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {authorName ? (
                <span
                  className="font-medium text-foreground"
                  title={details?.authorEmail}
                >
                  {authorName}
                </span>
              ) : null}
              {authorDate ? <span>committed {authorDate}</span> : null}
              {shortHash ? (
                <span className="ml-auto rounded-md bg-muted/60 px-1.5 py-0.5 font-mono">{shortHash}</span>
              ) : null}
            </div>
          </div>
        </div>

        <FilesSection files={files} />
      </div>
    </div>
  );
}

function RangeCommitRow({ commit, onSelect }: { commit: CommitInfo; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/50"
    >
      <GitCommitVertical className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs">{commit.subject}</span>
      <span className="flex shrink-0 items-center gap-2 text-[0.65rem] text-muted-foreground">
        <span>{commit.authorName}</span>
        <span>{formatDate(DAY_FORMAT, commit.authorDate)}</span>
        <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono">{commit.shortHash}</span>
      </span>
    </button>
  );
}

export function RangeDetailsPane() {
  const model = useReviewStore((state) => state.model);
  const compare = useReviewStore((state) => state.compare);
  const rangeCommits = useReviewStore((state) => state.rangeCommits);
  const setCompare = useReviewStore((state) => state.setCompare);

  const base = compare.kind === 'range' ? compare.base : '';
  const head = compare.kind === 'range' ? compare.head : null;
  const includesWorking = compare.kind === 'range' && head === null;
  const files = model && model.compare.kind === 'range' ? model.unreviewed : [];
  // git log order is newest-first; GitHub's compare view reads oldest-first.
  const commits = [
    ...rangeCommits,
  ].reverse();

  return (
    <div
      data-testid="range-details"
      className="h-full overflow-y-auto bg-background"
    >
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="flex items-start gap-3">
          <GitCompareArrows className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base leading-snug font-semibold">
              <span>Comparing</span>
              <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-sm">{base.slice(0, 7)}</span>
              <span className="text-muted-foreground">…</span>
              <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-sm">
                {head ? head.slice(0, 7) : 'working tree'}
              </span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {commits.length} commit{commits.length === 1 ? '' : 's'}
              {includesWorking ? ' plus uncommitted changes' : ''}, oldest first
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className={cn('rounded-lg border border-border', 'divide-y divide-border')}>
            {commits.map((commit) => (
              <RangeCommitRow
                key={commit.hash}
                commit={commit}
                onSelect={() =>
                  void setCompare({
                    kind: 'commit',
                    ref: commit.hash,
                  })
                }
              />
            ))}
            {includesWorking ? (
              <div className="flex items-center gap-2.5 px-3 py-2">
                <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">Working tree</span>
                <span className="shrink-0 text-[0.65rem] text-muted-foreground">Uncommitted changes</span>
              </div>
            ) : null}
            {commits.length === 0 && !includesWorking ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">No commits in range</div>
            ) : null}
          </div>
        </div>

        <FilesSection files={files} />
      </div>
    </div>
  );
}
