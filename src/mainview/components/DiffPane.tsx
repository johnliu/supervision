// Renders the selected file's diff using @pierre/diffs. `diffStyle` switches
// between unified and split. Clicking a line number opens an inline comment
// composer; existing comments render inline as annotations.

import { type DiffLineAnnotation, MultiFileDiff, Virtualizer } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';
import { useReviewStore } from '../store';
import { CommentComposer, CommentThread, type Draft } from './CommentThread';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

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
  const approve = useReviewStore((state) => state.approve);
  const unapprove = useReviewStore((state) => state.unapprove);
  const working = useReviewStore((state) => state.compare.kind === 'working');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [side, setSide] = useState<'new' | 'approved'>('new');

  // A file edited again after approval appears in both buckets; let the user
  // toggle between the staged ("approved") side and the unstaged ("new") side.
  const unstagedEntry = useMemo(
    () => model?.unreviewed.find((entry) => entry.path === selectedPath) ?? null,
    [
      model,
      selectedPath,
    ],
  );
  const stagedEntry = useMemo(
    () => model?.reviewed.find((entry) => entry.path === selectedPath) ?? null,
    [
      model,
      selectedPath,
    ],
  );
  const hasBoth = unstagedEntry !== null && stagedEntry !== null;
  const effectiveSide = side === 'approved' && stagedEntry ? 'approved' : 'new';
  const file = effectiveSide === 'approved' ? stagedEntry : (unstagedEntry ?? stagedEntry);

  const fileComments = useMemo(
    () => comments.filter((comment) => comment.path === file?.path),
    [
      comments,
      file,
    ],
  );

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to review
      </div>
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
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3 text-xs">
        <span className="truncate text-foreground">{file.path}</span>
        {file.binary ? (
          <span className="shrink-0 font-mono text-muted-foreground">binary</span>
        ) : (
          <span className="shrink-0 font-mono text-muted-foreground">
            <span className="text-emerald-500">+{file.additions}</span>{' '}
            <span className="text-red-500">−{file.deletions}</span>
          </span>
        )}
        {hasBoth ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={effectiveSide}
            onValueChange={(value) => {
              if (value === 'new' || value === 'approved') {
                setSide(value);
              }
            }}
          >
            <ToggleGroupItem value="new">New</ToggleGroupItem>
            <ToggleGroupItem value="approved">Approved</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        {working ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() =>
              file.staged
                ? unapprove([
                    file.path,
                  ])
                : approve([
                    file.path,
                  ])
            }
          >
            {file.staged ? 'Unapprove' : 'Approve'}
          </Button>
        ) : null}
      </div>
      {file.binary ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
          Binary file — diff not shown
        </div>
      ) : (
        <Virtualizer className="min-h-0 flex-1 overflow-auto bg-background">
          <MultiFileDiff<AnnotationMeta>
            key={`${file.path}:${file.staged ? 'staged' : 'unstaged'}`}
            oldFile={{
              name: file.oldPath ?? file.path,
              contents: file.oldContents,
            }}
            newFile={{
              name: file.path,
              contents: file.newContents,
            }}
            options={{
              diffStyle,
              theme: {
                dark: 'pierre-dark',
                light: 'pierre-light',
              },
              themeType: 'dark',
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
      )}
    </div>
  );
}
