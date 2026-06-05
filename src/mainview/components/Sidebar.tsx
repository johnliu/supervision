// Changed-files sidebar, split into "Needs review" (unstaged + untracked) and
// "Reviewed" (staged). A simple list for now; Phase 2 upgrades this to
// @pierre/trees. Each row shows status + line counts and an approve toggle.

import type { FileChange, FileStatus } from '../../shared/types';
import { useReviewStore } from '../store';

const STATUS_LABEL: Record<FileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
};

const STATUS_COLOR: Record<FileStatus, string> = {
  added: 'text-green-400',
  modified: 'text-amber-400',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
  untracked: 'text-green-400',
};

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

interface FileRowProps {
  file: FileChange;
  selected: boolean;
  onSelect: () => void;
  onToggleApprove: () => void;
}

function FileRow({ file, selected, onSelect, onToggleApprove }: FileRowProps) {
  return (
    <div
      className={`group flex items-center gap-2 px-3 py-1.5 text-sm ${
        selected ? 'bg-neutral-800' : 'hover:bg-neutral-900'
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={onSelect}
      >
        <span className={`w-3 shrink-0 font-mono text-xs ${STATUS_COLOR[file.status]}`}>
          {STATUS_LABEL[file.status]}
        </span>
        <span className="truncate text-neutral-200">{basename(file.path)}</span>
        <span className="truncate text-xs text-neutral-500">{dirname(file.path)}</span>
        <span className="ml-auto shrink-0 font-mono text-xs text-neutral-500">
          <span className="text-green-500">+{file.additions}</span>{' '}
          <span className="text-red-500">-{file.deletions}</span>
        </span>
      </button>
      <button
        type="button"
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100"
        onClick={onToggleApprove}
      >
        {file.staged ? 'Unapprove' : 'Approve'}
      </button>
    </div>
  );
}

interface SectionProps {
  title: string;
  files: FileChange[];
}

function Section({ title, files }: SectionProps) {
  const selectedPath = useReviewStore((state) => state.selectedPath);
  const select = useReviewStore((state) => state.select);
  const approve = useReviewStore((state) => state.approve);
  const unapprove = useReviewStore((state) => state.unapprove);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="mb-2">
      <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title} ({files.length})
      </div>
      {files.map((file) => (
        <FileRow
          key={`${title}:${file.path}`}
          file={file}
          selected={selectedPath === file.path}
          onSelect={() => select(file.path)}
          onToggleApprove={() =>
            file.staged
              ? unapprove([
                  file.path,
                ])
              : approve([
                  file.path,
                ])
          }
        />
      ))}
    </div>
  );
}

export function Sidebar() {
  const model = useReviewStore((state) => state.model);

  return (
    <div className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-r border-neutral-800 bg-neutral-950 py-2">
      {model ? (
        <>
          <Section
            title="Needs review"
            files={model.unreviewed}
          />
          <Section
            title="Reviewed"
            files={model.reviewed}
          />
          {model.unreviewed.length === 0 && model.reviewed.length === 0 ? (
            <div className="px-3 py-4 text-sm text-neutral-500">No changes</div>
          ) : null}
        </>
      ) : (
        <div className="px-3 py-4 text-sm text-neutral-500">Loading…</div>
      )}
    </div>
  );
}
