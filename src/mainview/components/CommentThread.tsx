// Inline annotation content rendered by @pierre/diffs `renderAnnotation`:
// `CommentThread` shows an existing comment; `CommentComposer` is the draft
// editor opened when a line number is clicked.

import { useState } from 'react';
import type { AnnotationSide, Comment } from '../../shared/types';
import { useReviewStore } from '../store';

export interface Draft {
  path: string;
  line: number;
  side: AnnotationSide;
}

export function CommentThread({ comment }: { comment: Comment }) {
  const resolveComment = useReviewStore((state) => state.resolveComment);
  const deleteComment = useReviewStore((state) => state.deleteComment);
  const resolved = comment.status === 'resolved';

  return (
    <div className="my-1 rounded border border-neutral-700 bg-neutral-900 p-2 text-sm">
      <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
        <span className={resolved ? 'text-green-500' : 'text-amber-400'}>{resolved ? 'Resolved' : 'Comment'}</span>
        <span>· line {comment.line}</span>
        <div className="ml-auto flex gap-1">
          {resolved ? null : (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
              onClick={() => resolveComment(comment.id)}
            >
              Resolve
            </button>
          )}
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-red-300"
            onClick={() => deleteComment(comment.id)}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="whitespace-pre-wrap text-neutral-200">{comment.body}</div>
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
      body: trimmed,
    });
    setBody('');
    onClose();
  };

  return (
    <div className="my-1 rounded border border-blue-700 bg-neutral-900 p-2">
      <textarea
        // biome-ignore lint/a11y/noAutofocus: composer opens on explicit user action
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={`Comment on line ${draft.line} (⌘/Ctrl+Enter to save)`}
        className="h-16 w-full resize-none rounded bg-neutral-950 p-1.5 text-sm text-neutral-100 outline-none"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            void submit();
          } else if (event.key === 'Escape') {
            onClose();
          }
        }}
      />
      <div className="mt-1 flex justify-end gap-1 text-xs">
        <button
          type="button"
          className="rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-700"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded bg-blue-700 px-2 py-0.5 text-neutral-100 hover:bg-blue-600"
          onClick={() => void submit()}
        >
          Comment
        </button>
      </div>
    </div>
  );
}
