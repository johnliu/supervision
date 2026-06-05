// Renders the selected file's diff using @pierre/diffs. `diffStyle` switches
// between unified and split. Clicking a line number opens an inline comment
// composer; existing comments render inline as annotations.

import { type DiffLineAnnotation, PatchDiff, Virtualizer } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';
import { useReviewStore } from '../store';
import { CommentComposer, CommentThread, type Draft } from './CommentThread';

type AnnotationMeta =
  | {
      kind: 'comment';
      id: string;
    }
  | {
      kind: 'draft';
    };

export function DiffPane() {
  const model = useReviewStore((state) => state.model);
  const selectedPath = useReviewStore((state) => state.selectedPath);
  const diffStyle = useReviewStore((state) => state.diffStyle);
  const comments = useReviewStore((state) => state.comments);
  const [draft, setDraft] = useState<Draft | null>(null);

  const file = useMemo(() => {
    if (!model || !selectedPath) {
      return null;
    }
    // Prefer the unstaged ("new") side when a file appears in both buckets.
    const all = [
      ...model.unreviewed,
      ...model.reviewed,
    ];
    return all.find((entry) => entry.path === selectedPath) ?? null;
  }, [
    model,
    selectedPath,
  ]);

  const fileComments = useMemo(
    () => comments.filter((comment) => comment.path === file?.path),
    [
      comments,
      file,
    ],
  );

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">Select a file to review</div>
    );
  }

  const annotations: DiffLineAnnotation<AnnotationMeta>[] = [
    ...fileComments.map((comment) => ({
      side: comment.side,
      lineNumber: comment.line,
      metadata: {
        kind: 'comment' as const,
        id: comment.id,
      },
    })),
    ...(draft && draft.path === file.path
      ? [
          {
            side: draft.side,
            lineNumber: draft.line,
            metadata: {
              kind: 'draft' as const,
            },
          },
        ]
      : []),
  ];

  return (
    <Virtualizer className="h-full overflow-auto bg-neutral-950">
      <PatchDiff<AnnotationMeta>
        key={`${file.path}:${file.staged ? 'staged' : 'unstaged'}`}
        patch={file.patch}
        options={{
          diffStyle,
          theme: {
            dark: 'pierre-dark',
            light: 'pierre-light',
          },
          themeType: 'system',
          onLineNumberClick: (props) => {
            setDraft({
              path: file.path,
              line: props.lineNumber,
              side: props.annotationSide,
            });
          },
        }}
        lineAnnotations={annotations}
        renderAnnotation={(annotation) => {
          const meta = annotation.metadata;
          if (meta.kind === 'draft') {
            return (
              <CommentComposer
                draft={{
                  path: file.path,
                  line: annotation.lineNumber,
                  side: annotation.side,
                }}
                onClose={() => setDraft(null)}
              />
            );
          }
          const comment = fileComments.find((entry) => entry.id === meta.id);
          return comment ? <CommentThread comment={comment} /> : null;
        }}
        disableWorkerPool
      />
    </Virtualizer>
  );
}
