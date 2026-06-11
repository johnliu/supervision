// In-memory implementation of the full SupervisionRPC contract, seeded from a
// fixture scenario. Semantics mirror the Bun handlers (src/bun/rpc.ts +
// comments.ts) so the app behaves identically in web mode: approve/unapprove
// move files between buckets, comments persist (in memory), config round-trips,
// and setRepo switches between fixture "repos" with a repoChanged push.

import { CONFIG_DEFAULTS } from '../../shared/config';
import { renderMarkdown } from '../../shared/reviewMarkdown';
import type { Comment, CommitInfo, ReviewModel, SupervisionConfig } from '../../shared/types';
import type { PlatformBackend, RepoChangedInfo, SupervisionApi } from '../platform';
import type { DiffStyle } from '../store';
import { type FixtureData, fixtureIds, getFixture } from './fixtures';

export interface FixtureBackendOptions {
  style?: DiffStyle;
  ignoreWhitespace?: boolean;
  /** Artificial latency per call, for eyeballing loading states. */
  delay?: number;
}

export interface FixtureBackendHandle {
  backend: PlatformBackend;
  getState(): {
    model: ReviewModel;
    comments: Comment[];
    config: SupervisionConfig;
  };
  /** Swap the model and notify the app the way the file watcher would. */
  replaceModel(model: ReviewModel): void;
  emitWorkingTreeChanged(): void;
  emitMenuAction(action: string): void;
  emitRepoChanged(info: RepoChangedInfo): void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

// A deterministic fake history for the panel: newest first, fixed dates so
// snapshots and tests are stable.
const FIXTURE_LOG: CommitInfo[] = [
  [
    'Polish the review toolbar',
    '2026-06-10T16:20:00-07:00',
  ],
  [
    'Add comment threads to the diff',
    '2026-06-10T11:05:00-07:00',
  ],
  [
    'Wire the working-tree watcher',
    '2026-06-09T18:42:00-07:00',
  ],
  [
    'Teach the sidebar tree git status',
    '2026-06-09T09:30:00-07:00',
  ],
  [
    'Render side-by-side diffs',
    '2026-06-08T15:11:00-07:00',
  ],
  [
    'Bootstrap the electrobun shell',
    '2026-06-07T10:00:00-07:00',
  ],
].map(([subject, authorDate], index) => {
  const hash = `${(index + 1).toString(16).repeat(8)}`.slice(0, 40).padEnd(40, 'f');
  return {
    hash,
    shortHash: hash.slice(0, 7),
    subject,
    authorName: 'Fixture Author',
    authorDate,
  };
});

export function createFixtureBackend(fixture: FixtureData, opts: FixtureBackendOptions = {}): FixtureBackendHandle {
  let model = clone(fixture.model);
  let comments = clone(fixture.comments);
  const config: SupervisionConfig = {
    ...CONFIG_DEFAULTS,
    ...fixture.config,
    ...(opts.style
      ? {
          diffStyle: opts.style,
        }
      : {}),
    ...(opts.ignoreWhitespace !== undefined
      ? {
          ignoreWhitespace: opts.ignoreWhitespace,
        }
      : {}),
  };

  const treeListeners: Array<() => void> = [];
  const menuListeners: Array<(action: string) => void> = [];
  const repoListeners: Array<(info: RepoChangedInfo) => void> = [];

  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, opts.delay ?? 0));

  const recents = () => fixtureIds().map((id) => `fixture://${id}`);

  // Approve/unapprove: move matching entries between buckets, flipping
  // `staged` — the model-level equivalent of `git add` / `git restore --staged`.
  const move = (paths: string[], toStaged: boolean) => {
    const source = toStaged ? model.unreviewed : model.reviewed;
    const moving = source.filter((file) => paths.includes(file.path));
    model = {
      ...model,
      reviewed: toStaged
        ? [
            ...model.reviewed,
            ...moving.map((file) => ({
              ...file,
              staged: true,
            })),
          ]
        : model.reviewed.filter((file) => !paths.includes(file.path)),
      unreviewed: toStaged
        ? model.unreviewed.filter((file) => !paths.includes(file.path))
        : [
            ...model.unreviewed,
            ...moving.map((file) => ({
              ...file,
              staged: false,
            })),
          ],
    };
  };

  const api: SupervisionApi = {
    getRepoRoot: async () => {
      await wait();
      return {
        root: model.repoRoot,
        isRepo: true,
      };
    },
    getReview: async (params) => {
      await wait();
      return {
        ...clone(model),
        compare: params?.compare ?? model.compare,
      };
    },
    getLog: async () => {
      await wait();
      return clone(FIXTURE_LOG);
    },
    stage: async (params) => {
      await wait();
      move(params?.paths ?? [], true);
      return clone(model);
    },
    unstage: async (params) => {
      await wait();
      move(params?.paths ?? [], false);
      return clone(model);
    },
    getComments: async () => {
      await wait();
      return clone(comments);
    },
    saveComment: async (input) => {
      await wait();
      if (input) {
        const isRange = input.endLine !== undefined && input.endLine !== input.line;
        comments = [
          ...comments,
          {
            id: crypto.randomUUID(),
            path: input.path,
            line: input.line,
            side: input.side,
            ...(isRange
              ? {
                  endLine: input.endLine,
                  endSide: input.endSide ?? input.side,
                }
              : {}),
            body: input.body,
            status: 'open',
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return clone(comments);
    },
    resolveComment: async (params) => {
      await wait();
      comments = comments.map((comment) =>
        comment.id === params?.id
          ? {
              ...comment,
              status: 'resolved' as const,
            }
          : comment,
      );
      return clone(comments);
    },
    deleteComment: async (params) => {
      await wait();
      comments = comments.filter((comment) => comment.id !== params?.id);
      return clone(comments);
    },
    exportMarkdown: async () => {
      await wait();
      const open = comments.filter((comment) => comment.status === 'open');
      return {
        markdown: renderMarkdown(model.repoRoot, open),
        path: `${model.repoRoot}/.supervision/review-fixture.md`,
      };
    },
    getConfig: async () => {
      await wait();
      return {
        ...config,
      };
    },
    saveConfig: async (input) => {
      await wait();
      if (input) {
        config.diffStyle = input.diffStyle;
        config.ignoreWhitespace = input.ignoreWhitespace;
        config.lineWrap = input.lineWrap;
        config.fontSize = input.fontSize;
      }
      return {
        ...config,
      };
    },
    setRepo: async (params) => {
      await wait();
      const target = params?.path ?? '';
      const id = target.replace(/^fixture:\/\//, '');
      if (!fixtureIds().includes(id)) {
        return {
          ok: false,
          error: `Not a fixture: ${target}`,
        };
      }
      const next = getFixture(id);
      model = clone(next.model);
      comments = clone(next.comments);
      const info: RepoChangedInfo = {
        root: model.repoRoot,
        recents: recents(),
      };
      for (const cb of repoListeners) {
        cb(info);
      }
      return {
        ok: true,
        root: info.root,
        recents: info.recents,
      };
    },
    openProject: async () => {
      await wait();
      return {
        ok: false,
        cancelled: true,
      };
    },
    getRecentProjects: async () => {
      await wait();
      return recents();
    },
  };

  return {
    backend: {
      api,
      onWorkingTreeChanged: (cb) => treeListeners.push(cb),
      onMenuAction: (cb) => menuListeners.push(cb),
      onRepoChanged: (cb) => repoListeners.push(cb),
    },
    getState: () => ({
      model: clone(model),
      comments: clone(comments),
      config: {
        ...config,
      },
    }),
    replaceModel: (next) => {
      model = clone(next);
      for (const cb of treeListeners) {
        cb();
      }
    },
    emitWorkingTreeChanged: () => {
      for (const cb of treeListeners) {
        cb();
      }
    },
    emitMenuAction: (action) => {
      for (const cb of menuListeners) {
        cb(action);
      }
    },
    emitRepoChanged: (info) => {
      for (const cb of repoListeners) {
        cb(info);
      }
    },
  };
}
