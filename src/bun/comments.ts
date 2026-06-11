// Comment persistence. Comments live in `.supervision/comments.json` at the
// repo root — the source of truth, and the contract the installable skill reads.
// `exportMarkdown` renders the open comments to a human/LLM-friendly Markdown
// file (also returned so the webview can copy it to the clipboard).
//
// Anchoring: a comment pins line numbers into a file that keeps moving. Each
// comment records the state it was made against (HEAD sha + the working-tree
// file's blob sha). Every read compares the recorded blob sha to the current
// file and flags drifted comments `stale` — a derived field that is stripped
// on write, never persisted.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderMarkdown } from '../shared/reviewMarkdown';
import type { AnnotationSide, Comment, CommentAnchor, CommentsFile } from '../shared/types';
import { git } from './git';

export interface NewComment {
  path: string;
  line: number;
  side: AnnotationSide;
  endLine?: number;
  endSide?: AnnotationSide;
  body: string;
}

function supervisionDir(repoRoot: string): string {
  return path.join(repoRoot, '.supervision');
}

function commentsPath(repoRoot: string): string {
  return path.join(supervisionDir(repoRoot), 'comments.json');
}

/**
 * Older skills wrote a single `response` string instead of a `replies` entry.
 * Fold it into the thread (as the latest agent reply) and drop the field, so
 * app code only ever sees `replies`. The deterministic id keeps the fold
 * idempotent across reads; the next write persists the folded shape.
 */
function foldLegacyResponse(comment: Comment): Comment {
  if (!comment.response) {
    return comment;
  }
  const { response, ...rest } = comment;
  return {
    ...rest,
    replies: [
      ...(comment.replies ?? []),
      {
        id: `${comment.id}:response`,
        author: 'agent',
        body: response,
        createdAt: comment.createdAt,
      },
    ],
  };
}

/** The persisted comments — no staleness annotation, legacy fields folded. */
async function readRaw(repoRoot: string): Promise<Comment[]> {
  const file = Bun.file(commentsPath(repoRoot));
  if (!(await file.exists())) {
    return [];
  }
  try {
    const data = (await file.json()) as CommentsFile;
    return Array.isArray(data.comments) ? data.comments.map(foldLegacyResponse) : [];
  } catch {
    return [];
  }
}

async function writeComments(repoRoot: string, comments: Comment[]): Promise<void> {
  await mkdir(supervisionDir(repoRoot), {
    recursive: true,
  });
  const data: CommentsFile = {
    version: 1,
    repo: repoRoot,
    // `stale` is derived from the anchor on every read; persisting it would
    // freeze one read's verdict into the contract file agents edit.
    comments: comments.map(({ stale: _stale, ...comment }) => comment),
  };
  await Bun.write(commentsPath(repoRoot), `${JSON.stringify(data, null, 2)}\n`);
}

/** Blob sha of the working-tree file, or null when it doesn't exist. */
async function workingBlobSha(repoRoot: string, relPath: string): Promise<string | null> {
  const res = await git(repoRoot, [
    'hash-object',
    '--',
    relPath,
  ]);
  return res.exitCode === 0 ? res.stdout.trim() : null;
}

/** The working-tree state `relPath`'s line numbers are being recorded against. */
async function captureAnchor(repoRoot: string, relPath: string): Promise<CommentAnchor> {
  const [headRes, blob] = await Promise.all([
    git(repoRoot, [
      'rev-parse',
      'HEAD',
    ]),
    workingBlobSha(repoRoot, relPath),
  ]);
  return {
    head: headRes.exitCode === 0 ? headRes.stdout.trim() : null,
    blob,
  };
}

/**
 * Flag open, anchored comments whose file no longer matches the recorded blob
 * sha. One `git hash-object` per distinct path; comments without a usable
 * anchor (pre-anchor comments, files that were absent at creation) pass
 * through unflagged — staleness is unknown, not asserted.
 */
async function annotateStaleness(repoRoot: string, comments: Comment[]): Promise<Comment[]> {
  const paths = [
    ...new Set(comments.filter((c) => c.status === 'open' && c.anchor?.blob).map((c) => c.path)),
  ];
  if (paths.length === 0) {
    return comments;
  }
  const current = new Map(
    await Promise.all(
      paths.map(
        async (p) =>
          [
            p,
            await workingBlobSha(repoRoot, p),
          ] as const,
      ),
    ),
  );
  return comments.map((comment) =>
    comment.status === 'open' && comment.anchor?.blob
      ? {
          ...comment,
          stale: current.get(comment.path) !== comment.anchor.blob,
        }
      : comment,
  );
}

export async function readComments(repoRoot: string): Promise<Comment[]> {
  return annotateStaleness(repoRoot, await readRaw(repoRoot));
}

export async function addComment(repoRoot: string, input: NewComment): Promise<Comment[]> {
  const comments = await readRaw(repoRoot);
  const isRange = input.endLine !== undefined && input.endLine !== input.line;
  comments.push({
    id: crypto.randomUUID(),
    path: input.path,
    line: input.line,
    side: input.side,
    // Only persist range fields for genuine multi-line selections.
    ...(isRange
      ? {
          endLine: input.endLine,
          endSide: input.endSide ?? input.side,
        }
      : {}),
    body: input.body,
    status: 'open',
    createdAt: new Date().toISOString(),
    anchor: await captureAnchor(repoRoot, input.path),
  });
  await writeComments(repoRoot, comments);
  return annotateStaleness(repoRoot, comments);
}

export async function resolveComment(repoRoot: string, id: string): Promise<Comment[]> {
  const next = (await readRaw(repoRoot)).map((comment) =>
    comment.id === id
      ? {
          ...comment,
          status: 'resolved' as const,
        }
      : comment,
  );
  await writeComments(repoRoot, next);
  return annotateStaleness(repoRoot, next);
}

export async function replyToComment(repoRoot: string, id: string, body: string): Promise<Comment[]> {
  const next = (await readRaw(repoRoot)).map((comment) =>
    comment.id === id
      ? {
          ...comment,
          replies: [
            ...(comment.replies ?? []),
            {
              id: crypto.randomUUID(),
              author: 'user' as const,
              body,
              createdAt: new Date().toISOString(),
            },
          ],
        }
      : comment,
  );
  await writeComments(repoRoot, next);
  return annotateStaleness(repoRoot, next);
}

export async function deleteComment(repoRoot: string, id: string): Promise<Comment[]> {
  const next = (await readRaw(repoRoot)).filter((comment) => comment.id !== id);
  await writeComments(repoRoot, next);
  return annotateStaleness(repoRoot, next);
}

/** Delete every comment with the given status (the panel's bulk "Clear"). */
export async function clearComments(repoRoot: string, status: Comment['status']): Promise<Comment[]> {
  const next = (await readRaw(repoRoot)).filter((comment) => comment.status !== status);
  await writeComments(repoRoot, next);
  return annotateStaleness(repoRoot, next);
}

export async function exportMarkdown(repoRoot: string): Promise<{
  markdown: string;
  path: string;
}> {
  const open = (await readComments(repoRoot)).filter((comment) => comment.status === 'open');
  const markdown = renderMarkdown(repoRoot, open);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(supervisionDir(repoRoot), `review-${stamp}.md`);
  await mkdir(supervisionDir(repoRoot), {
    recursive: true,
  });
  await Bun.write(outPath, markdown);
  return {
    markdown,
    path: outPath,
  };
}
