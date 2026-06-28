// "Read" state: a per-file flag the reviewer sets to say "I've looked at this"
// — separate from approving (staging). It lives in `.supervision/read.json` at
// the repo root, alongside comments.json, and like that file it's gitignored,
// so read state is personal and per-checkout.
//
// Content-addressing: marking a file read records a hash of the exact bytes the
// reviewer saw (the diff's new side, `newContents`, already in memory — so no
// git calls; a deletion has no new side, so it hashes the removed old side
// instead). Every review re-derives the flag by re-hashing and comparing; any
// edit silently clears it (the file resurfaces), an unchanged file stays read
// across restarts and across compare modes. This mirrors how comments.ts flags
// drifted comments `stale`, but keyed on content rather than a git blob sha —
// which keeps this module free of any `git` import (and the cycle that would
// create, since comments.ts/git.ts already lean the other way).

import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FileChange, ReviewModel } from '../shared/types';

/** One marked-read file: the path and the hash of the bytes that were read. */
interface ReadEntry {
  path: string;
  /** sha256(newContents) at the time it was marked read. */
  hash: string;
  readAt: string;
}

/** Shape of `.supervision/read.json`. */
interface ReadStateFile {
  version: 1;
  repo: string;
  files: ReadEntry[];
}

function supervisionDir(repoRoot: string): string {
  return path.join(repoRoot, '.supervision');
}

function readStatePath(repoRoot: string): string {
  return path.join(supervisionDir(repoRoot), 'read.json');
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

/**
 * The hash a file would be marked read against, or null when it can't be marked.
 * Binary files have no readable content. A deletion has no new side, so it's
 * fingerprinted against the removed bytes (the old side) — namespaced so a later
 * re-add of the same content at the same path doesn't inherit the read flag. An
 * empty side hashes to null rather than a shared empty-string hash that would
 * collide across every such file.
 */
function fingerprint(file: FileChange): string | null {
  if (file.binary) {
    return null;
  }
  if (file.status === 'deleted') {
    return file.oldContents === '' ? null : sha256(`deleted\0${file.oldContents}`);
  }
  if (file.newContents === '') {
    return null;
  }
  return sha256(file.newContents);
}

async function readRaw(repoRoot: string): Promise<ReadEntry[]> {
  const file = Bun.file(readStatePath(repoRoot));
  if (!(await file.exists())) {
    return [];
  }
  try {
    const data = (await file.json()) as ReadStateFile;
    return Array.isArray(data.files) ? data.files : [];
  } catch {
    return [];
  }
}

async function writeReadState(repoRoot: string, files: ReadEntry[]): Promise<void> {
  await mkdir(supervisionDir(repoRoot), {
    recursive: true,
  });
  const data: ReadStateFile = {
    version: 1,
    repo: repoRoot,
    files,
  };
  await Bun.write(readStatePath(repoRoot), `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Set `read` on every file by comparing its current content hash to the
 * recorded one. Fast-returns the model untouched when nothing is marked (the
 * builders already default `read: false`), so a repo with no read state pays
 * no hashing.
 */
export async function annotateRead(repoRoot: string, model: ReviewModel): Promise<ReviewModel> {
  const byPath = new Map(
    (await readRaw(repoRoot)).map((entry) => [
      entry.path,
      entry.hash,
    ]),
  );
  if (byPath.size === 0) {
    return model;
  }
  const annotate = (file: FileChange): FileChange => {
    const hash = fingerprint(file);
    return {
      ...file,
      read: hash !== null && byPath.get(file.path) === hash,
    };
  };
  return {
    ...model,
    reviewed: model.reviewed.map(annotate),
    unreviewed: model.unreviewed.map(annotate),
  };
}

/**
 * Mark `paths` read, fingerprinting against `model` (the unstaged side wins for
 * a file present in both buckets — it's the content shown by default). Replaces
 * any prior entry for those paths, so there's one entry per path. Paths that
 * can't be marked (binary, an empty side, or absent from the model) are skipped.
 */
export async function markRead(repoRoot: string, paths: string[], model: ReviewModel): Promise<void> {
  const targets = new Set(paths);
  const kept = (await readRaw(repoRoot)).filter((entry) => !targets.has(entry.path));
  const byPath = new Map<string, FileChange>();
  for (const file of model.reviewed) {
    byPath.set(file.path, file);
  }
  for (const file of model.unreviewed) {
    byPath.set(file.path, file); // unstaged side overwrites the staged one
  }
  const readAt = new Date().toISOString();
  for (const p of paths) {
    const file = byPath.get(p);
    const hash = file ? fingerprint(file) : null;
    if (hash !== null) {
      kept.push({
        path: p,
        hash,
        readAt,
      });
    }
  }
  await writeReadState(repoRoot, kept);
}

/** Drop `paths` from the read set (the file goes back to unread). */
export async function unmarkRead(repoRoot: string, paths: string[]): Promise<void> {
  const targets = new Set(paths);
  await writeReadState(
    repoRoot,
    (await readRaw(repoRoot)).filter((entry) => !targets.has(entry.path)),
  );
}
