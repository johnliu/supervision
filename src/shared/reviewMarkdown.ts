// Pure rendering of open review comments to Markdown. Shared by the Bun
// exporter (src/bun/comments.ts, which writes it to disk and copies it to the
// clipboard) and the web fixture backend (which only returns it).

import type { Comment } from './types';

export function renderMarkdown(repoRoot: string, comments: Comment[]): string {
  const lines = [
    `# Code review for ${repoRoot}`,
    '',
    `${comments.length} open comment(s).`,
    '',
  ];
  const byFile = new Map<string, Comment[]>();
  for (const comment of comments) {
    const list = byFile.get(comment.path) ?? [];
    list.push(comment);
    byFile.set(comment.path, list);
  }
  for (const [file, list] of byFile) {
    lines.push(`## ${file}`, '');
    for (const comment of list.sort((a, b) => a.line - b.line)) {
      const loc =
        comment.endLine && comment.endLine !== comment.line
          ? `${file}:${comment.line}-${comment.endLine}`
          : `${file}:${comment.line}`;
      lines.push(`- **${loc}** (${comment.side}): ${comment.body}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
