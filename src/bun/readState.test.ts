// Read state: a per-file "I've looked at this" flag, separate from staging,
// content-addressed against the bytes shown (the diff's new side) and persisted
// to `.supervision/read.json`. These drive the flag through the real getReview
// path (which runs annotateRead), so they pin the headline behavior: an
// unchanged file stays read across reviews; any edit silently clears it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FileChange, ReviewModel } from '../shared/types';
import { getReview, git } from './git';
import { markRead, unmarkRead } from './readState';

let repo: string;

async function initRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'supervision-read-'));
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
  // Two committed files we can delete, to exercise the empty-content guard.
  await Bun.write(path.join(root, 'gone.ts'), 'export const gone = 1;\n');
  await Bun.write(path.join(root, 'gone2.ts'), 'export const gone = 2;\n');
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

const WORKING = {
  kind: 'working' as const,
};

/** The working-tree review (the default mode), which annotates read state. */
function review(root: string): Promise<ReviewModel> {
  return getReview(root, WORKING, false);
}

function fileIn(model: ReviewModel, p: string): FileChange | undefined {
  return [
    ...model.unreviewed,
    ...model.reviewed,
  ].find((file) => file.path === p);
}

async function readJson(root: string): Promise<{
  files: Array<{
    path: string;
    hash: string;
    readAt: string;
  }>;
}> {
  return Bun.file(path.join(root, '.supervision', 'read.json')).json();
}

beforeEach(async () => {
  repo = await initRepo();
  // A standing unstaged change so app.ts shows up in the review.
  await Bun.write(path.join(repo, 'app.ts'), 'const a = 1;\nconst b = 2;\n');
});

afterEach(async () => {
  await rm(repo, {
    recursive: true,
    force: true,
  });
});

describe('read state', () => {
  test('READ-1: marking a file read records its content hash and flags it read', async () => {
    const before = await review(repo);
    const target = fileIn(before, 'app.ts');
    expect(target?.read).toBe(false);

    await markRead(
      repo,
      [
        'app.ts',
      ],
      before,
    );

    const stored = await readJson(repo);
    expect(stored.files).toHaveLength(1);
    expect(stored.files[0]?.path).toBe('app.ts');
    expect(stored.files[0]?.hash).toBe(
      createHash('sha256')
        .update(target?.newContents ?? '')
        .digest('hex'),
    );
    expect(typeof stored.files[0]?.readAt).toBe('string');

    expect(fileIn(await review(repo), 'app.ts')?.read).toBe(true);
  });

  test('READ-2: editing the file clears read on the next review', async () => {
    await markRead(
      repo,
      [
        'app.ts',
      ],
      await review(repo),
    );
    expect(fileIn(await review(repo), 'app.ts')?.read).toBe(true);

    await Bun.write(path.join(repo, 'app.ts'), 'const a = 1;\nconst b = 3;\n');
    expect(fileIn(await review(repo), 'app.ts')?.read).toBe(false);
  });

  test('READ-3: an unchanged file stays read across reviews (persisted)', async () => {
    await markRead(
      repo,
      [
        'app.ts',
      ],
      await review(repo),
    );
    // The flag is re-derived from read.json each review — simulates a restart.
    expect(fileIn(await review(repo), 'app.ts')?.read).toBe(true);
    expect(fileIn(await review(repo), 'app.ts')?.read).toBe(true);
  });

  test('READ-4: unmarking removes the entry and the file reads as unread', async () => {
    await markRead(
      repo,
      [
        'app.ts',
      ],
      await review(repo),
    );
    await unmarkRead(repo, [
      'app.ts',
    ]);

    expect((await readJson(repo)).files).toHaveLength(0);
    expect(fileIn(await review(repo), 'app.ts')?.read).toBe(false);
  });

  test('READ-5: re-marking after an edit replaces the entry (one per path)', async () => {
    await markRead(
      repo,
      [
        'app.ts',
      ],
      await review(repo),
    );
    await Bun.write(path.join(repo, 'app.ts'), 'const a = 1;\nconst b = 3;\n');
    await markRead(
      repo,
      [
        'app.ts',
      ],
      await review(repo),
    );

    expect((await readJson(repo)).files).toHaveLength(1);
    expect(fileIn(await review(repo), 'app.ts')?.read).toBe(true);
  });

  test('READ-6: deleted files mark read against their old side, no cross-contamination', async () => {
    await rm(path.join(repo, 'gone.ts'));
    await rm(path.join(repo, 'gone2.ts'));
    const model = await review(repo);
    expect(fileIn(model, 'gone.ts')?.newContents).toBe('');

    // Both have empty new content but distinct old content, so each fingerprints
    // to a different hash — marking one read must not flag the other.
    await markRead(
      repo,
      [
        'gone.ts',
      ],
      model,
    );

    expect((await readJson(repo)).files).toHaveLength(1);
    const after = await review(repo);
    expect(fileIn(after, 'gone.ts')?.read).toBe(true);
    expect(fileIn(after, 'gone2.ts')?.read).toBe(false);
  });

  test('READ-9: editing a deleted file (restoring it changed) clears its read flag', async () => {
    await rm(path.join(repo, 'gone.ts'));
    await markRead(
      repo,
      [
        'gone.ts',
      ],
      await review(repo),
    );
    expect(fileIn(await review(repo), 'gone.ts')?.read).toBe(true);

    // Bringing the file back with different content turns the deletion into a
    // modification — a real new side, fingerprinted differently — so it reads
    // as unread rather than inheriting the deletion's flag.
    await Bun.write(path.join(repo, 'gone.ts'), 'export const gone = 99;\n');
    expect(fileIn(await review(repo), 'gone.ts')?.read).toBe(false);
  });

  test('READ-7: a corrupt read.json is treated as empty (no throw)', async () => {
    await Bun.write(path.join(repo, '.supervision', 'read.json'), '{ not json');
    const model = await review(repo);
    expect(fileIn(model, 'app.ts')?.read).toBe(false);
  });

  test('READ-8: a file staged and unstaged is fingerprinted on the unstaged side', async () => {
    await Bun.write(path.join(repo, 'app.ts'), 'const a = 2;\n');
    await git(repo, [
      'add',
      'app.ts',
    ]); // index = v2
    await Bun.write(path.join(repo, 'app.ts'), 'const a = 3;\n'); // working = v3

    await markRead(
      repo,
      [
        'app.ts',
      ],
      await review(repo),
    );

    const after = await review(repo);
    const unstaged = after.unreviewed.find((file) => file.path === 'app.ts');
    const staged = after.reviewed.find((file) => file.path === 'app.ts');
    expect(unstaged?.read).toBe(true); // working side was fingerprinted
    expect(staged?.read).toBe(false); // index side differs, so it's not read
  });
});
