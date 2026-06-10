// Comment persistence. Comments live in `.supervision/comments.json` at the
// repo root — the source of truth, and the contract the installable skill reads.
// `exportMarkdown` renders the open comments to a human/LLM-friendly Markdown
// file (also returned so the webview can copy it to the clipboard).

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderMarkdown } from '../shared/reviewMarkdown';
import type { AnnotationSide, Comment, CommentsFile } from '../shared/types';

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

export async function readComments(repoRoot: string): Promise<Comment[]> {
  const file = Bun.file(commentsPath(repoRoot));
  if (!(await file.exists())) {
    return [];
  }
  try {
    const data = (await file.json()) as CommentsFile;
    return Array.isArray(data.comments) ? data.comments : [];
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
    comments,
  };
  await Bun.write(commentsPath(repoRoot), `${JSON.stringify(data, null, 2)}\n`);
}

export async function addComment(repoRoot: string, input: NewComment): Promise<Comment[]> {
  const comments = await readComments(repoRoot);
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
  });
  await writeComments(repoRoot, comments);
  return comments;
}

export async function resolveComment(repoRoot: string, id: string): Promise<Comment[]> {
  const next = (await readComments(repoRoot)).map((comment) =>
    comment.id === id
      ? {
          ...comment,
          status: 'resolved' as const,
        }
      : comment,
  );
  await writeComments(repoRoot, next);
  return next;
}

export async function deleteComment(repoRoot: string, id: string): Promise<Comment[]> {
  const next = (await readComments(repoRoot)).filter((comment) => comment.id !== id);
  await writeComments(repoRoot, next);
  return next;
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
