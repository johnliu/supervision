// Inline annotation content rendered by @pierre/diffs `renderAnnotation`:
// `CommentThread` shows an existing comment; `CommentComposer` is the draft
// editor opened when a line number is clicked.
//
// Both cards cap their width: 36rem for a readable measure, and never closer
// than ~88px to their container's right edge — the strip the floating toolbar
// (size-9 cells + p-1.5 + right-4) occupies — so the bar never covers them.

import { useState } from 'react';
import type { Comment } from '../../shared/types';
import { type Draft, useReviewStore } from '../store';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

// Never wider than a readable measure, and never within the ~88px strip at
// the container's right edge where the floating toolbar sits — clearance is
// absolute; on very narrow panes the header's line label truncates to fit.
const CARD_WIDTH = 'max-w-[min(36rem,calc(100%-88px))]';

/** "line N" or "lines N–M" for a (possibly single-line) range. */
function lineLabel(line: number, endLine?: number): string {
  return endLine && endLine !== line ? `lines ${line}–${endLine}` : `line ${line}`;
}

export function CommentThread({ comment }: { comment: Comment }) {
  const resolveComment = useReviewStore((state) => state.resolveComment);
  const deleteComment = useReviewStore((state) => state.deleteComment);
  const resolved = comment.status === 'resolved';

  return (
    <div
      className={`my-1 ${CARD_WIDTH} rounded-md border border-border bg-card p-2 text-sm text-card-foreground shadow-sm`}
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className={resolved ? 'shrink-0 text-emerald-500' : 'shrink-0 text-amber-500'}>
          {resolved ? 'Resolved' : 'Comment'}
        </span>
        <span className="min-w-0 truncate">· {lineLabel(comment.line, comment.endLine)}</span>
        <div className="ml-auto flex shrink-0 gap-1">
          {resolved ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => resolveComment(comment.id)}
            >
              Resolve
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => deleteComment(comment.id)}
          >
            Delete
          </Button>
        </div>
      </div>
      <div className="whitespace-pre-wrap">{comment.body}</div>
    </div>
  );
}

export function CommentComposer({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const addComment = useReviewStore((state) => state.addComment);
  const [body, setBody] = useState('');

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) {
      return;
    }
    await addComment({
      path: draft.path,
      line: draft.line,
      side: draft.side,
      endLine: draft.endLine,
      endSide: draft.endSide,
      body: trimmed,
    });
    setBody('');
    onClose();
  };

  return (
    <div className={`my-1 ${CARD_WIDTH} rounded-md border border-ring/50 bg-card p-2 shadow-sm`}>
      <Textarea
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={`Comment on ${lineLabel(draft.line, draft.endLine)} (⌘/Ctrl+Enter to save)`}
        className="h-16 resize-none text-sm"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            void submit();
          } else if (event.key === 'Escape') {
            onClose();
          }
        }}
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => void submit()}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}
