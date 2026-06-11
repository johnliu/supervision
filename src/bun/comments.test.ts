// Comment anchoring: each comment records the repo state it was made against
// (HEAD sha + working-tree blob sha), and reads flag comments whose file has
// since changed as `stale` — derived per read, never persisted.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addComment, clearComments, readComments, replyToComment, resolveComment } from './comments';
import { git } from './git';

let repo: string;

async function initRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'supervision-comments-'));
  await git(root, [
    'init',
  ]);
  await git(root, [
    'config',
    'user.email',
    'test@example.com',
  ]);
  await git(root, [
    'config',
    'user.name',
    'Test',
  ]);
  await Bun.write(path.join(root, 'app.ts'), 'const a = 1;\n');
  await git(root, [
    'add',
    '.',
  ]);
  await git(root, [
    'commit',
    '-m',
    'init',
  ]);
  return root;
}

function comment(body = 'tighten this up') {
  return {
    path: 'app.ts',
    line: 1,
    side: 'additions' as const,
    body,
  };
}

beforeEach(async () => {
  repo = await initRepo();
});

afterEach(async () => {
  await rm(repo, {
    recursive: true,
    force: true,
  });
});

describe('comment anchoring', () => {
  test('ANC-1: a new comment records the HEAD and working-tree blob shas', async () => {
    const [saved] = await addComment(repo, comment());
    const head = (
      await git(repo, [
        'rev-parse',
        'HEAD',
      ])
    ).stdout.trim();
    const blob = (
      await git(repo, [
        'hash-object',
        '--',
        'app.ts',
      ])
    ).stdout.trim();
    expect(saved.anchor).toEqual({
      head,
      blob,
    });
    expect(saved.stale).toBe(false);
  });

  test('ANC-2: editing the file flips the comment to stale on the next read', async () => {
    await addComment(repo, comment());
    await Bun.write(path.join(repo, 'app.ts'), 'const a = 2;\n');
    const [read] = await readComments(repo);
    expect(read.stale).toBe(true);
  });

  test('ANC-3: deleting the file also reads as stale', async () => {
    await addComment(repo, comment());
    await rm(path.join(repo, 'app.ts'));
    const [read] = await readComments(repo);
    expect(read.stale).toBe(true);
  });

  test('ANC-4: stale is derived, not persisted to comments.json', async () => {
    await addComment(repo, comment());
    await Bun.write(path.join(repo, 'app.ts'), 'const a = 2;\n');
    await readComments(repo);
    const file = await Bun.file(path.join(repo, '.supervision', 'comments.json')).json();
    expect(file.comments[0].anchor).toBeDefined();
    expect('stale' in file.comments[0]).toBe(false);
  });

  test('ANC-5: resolved comments are never flagged', async () => {
    const [saved] = await addComment(repo, comment());
    await Bun.write(path.join(repo, 'app.ts'), 'const a = 2;\n');
    const resolved = await resolveComment(repo, saved.id);
    expect(resolved[0].status).toBe('resolved');
    expect(resolved[0].stale).toBeUndefined();
  });

  test('THR-1: replyToComment appends a user reply to the thread', async () => {
    const [saved] = await addComment(repo, comment());
    await replyToComment(repo, saved.id, 'first follow-up');
    const after = await replyToComment(repo, saved.id, 'second follow-up');
    expect(
      after[0].replies?.map((r) => [
        r.author,
        r.body,
      ]),
    ).toEqual([
      [
        'user',
        'first follow-up',
      ],
      [
        'user',
        'second follow-up',
      ],
    ]);
  });

  test('THR-2: a legacy response field folds into replies as an agent entry', async () => {
    await Bun.write(
      path.join(repo, '.supervision', 'comments.json'),
      JSON.stringify({
        version: 1,
        repo,
        comments: [
          {
            id: 'legacy',
            ...comment('please rename'),
            status: 'open',
            createdAt: '2026-06-01T10:00:00.000Z',
            response: 'Renamed it.',
          },
        ],
      }),
    );
    const [read] = await readComments(repo);
    expect(read.response).toBeUndefined();
    expect(read.replies).toEqual([
      {
        id: 'legacy:response',
        author: 'agent',
        body: 'Renamed it.',
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    ]);
    // A write persists the folded shape without duplicating the reply.
    await replyToComment(repo, 'legacy', 'thanks');
    const [reread] = await readComments(repo);
    expect(reread.replies?.length).toBe(2);
    const file = await Bun.file(path.join(repo, '.supervision', 'comments.json')).json();
    expect('response' in file.comments[0]).toBe(false);
  });

  test('CLR-1: clearComments deletes only the given status', async () => {
    const [first] = await addComment(repo, comment('fix this'));
    await addComment(repo, comment('and this'));
    await resolveComment(repo, first.id);

    const afterResolvedClear = await clearComments(repo, 'resolved');
    expect(afterResolvedClear.map((c) => c.status)).toEqual([
      'open',
    ]);

    const afterOpenClear = await clearComments(repo, 'open');
    expect(afterOpenClear).toEqual([]);
  });

  test('ANC-6: pre-anchor comments pass through with staleness unknown', async () => {
    await Bun.write(
      path.join(repo, '.supervision', 'comments.json'),
      JSON.stringify({
        version: 1,
        repo,
        comments: [
          {
            id: 'legacy',
            ...comment('from before anchors existed'),
            status: 'open',
            createdAt: '2026-06-01T10:00:00.000Z',
          },
        ],
      }),
    );
    await Bun.write(path.join(repo, 'app.ts'), 'const a = 2;\n');
    const [read] = await readComments(repo);
    expect(read.stale).toBeUndefined();
  });
});
