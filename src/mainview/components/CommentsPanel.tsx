// Sidebar comments tab: every comment on the repo, open ones first. Clicking
// a comment selects its file and scrolls the diff to the commented line
// (store.jumpToComment → DiffPane consumes the scroll target).

import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Comment } from '../../shared/types';
import { useReviewStore } from '../store';

function lineLabel(comment: Comment): string {
  return comment.endLine && comment.endLine !== comment.line ? `${comment.line}–${comment.endLine}` : `${comment.line}`;
}

function byLocation(a: Comment, b: Comment): number {
  return a.path.localeCompare(b.path) || a.line - b.line;
}

function CommentRow({ comment }: { comment: Comment }) {
  const jumpToComment = useReviewStore((state) => state.jumpToComment);
  const selected = useReviewStore((state) => state.selectedPath === comment.path);
  const resolved = comment.status === 'resolved';

  return (
    <button
      type="button"
      onClick={() => jumpToComment(comment)}
      className={cn(
        'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/50',
        selected && 'bg-sidebar-accent/30',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[0.65rem] text-muted-foreground">
        <span className={cn('size-1.5 shrink-0 rounded-full', resolved ? 'bg-muted-foreground/50' : 'bg-primary')} />
        <span className="truncate font-mono">
          {comment.path}:{lineLabel(comment)}
        </span>
      </span>
      <span className={cn('line-clamp-2 text-xs', resolved && 'text-muted-foreground line-through')}>
        {comment.body}
      </span>
    </button>
  );
}

export function CommentsPanel() {
  const comments = useReviewStore((state) => state.comments);
  const open = comments.filter((comment) => comment.status === 'open').sort(byLocation);
  const resolved = comments.filter((comment) => comment.status === 'resolved').sort(byLocation);

  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
        <MessageSquare className="size-4 opacity-60" />
        <span>
          No comments yet. Select lines in the diff and press <kbd className="font-mono">c</kbd>.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      {open.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 py-1 text-[0.65rem] font-semibold tracking-wide text-muted-foreground uppercase">
            Open <span className="font-normal opacity-60">{open.length}</span>
          </div>
          {open.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
            />
          ))}
        </div>
      ) : null}
      {resolved.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 py-1 text-[0.65rem] font-semibold tracking-wide text-muted-foreground uppercase">
            Resolved <span className="font-normal opacity-60">{resolved.length}</span>
          </div>
          {resolved.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
