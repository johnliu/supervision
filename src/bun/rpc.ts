// Bun side of the typed RPC. Owns the "current repo" the UI is reviewing and
// exposes git operations to the webview. Comment handlers are stubbed here and
// implemented in Phase 4.

import { BrowserView } from 'electrobun/bun';
import type { SupervisionRPC } from '../shared/rpc';
import * as git from './git';

/** The repo under review. Defaults to an env override, else the launch cwd. */
let currentRepo = process.env.SUPERVISION_REPO ?? process.cwd();

export function getCurrentRepo(): string {
  return currentRepo;
}

export function createSupervisionRPC() {
  return BrowserView.defineRPC<SupervisionRPC>({
    maxRequestTime: 30_000,
    handlers: {
      requests: {
        getRepoRoot: async () => {
          const root = await git.getRepoRoot(currentRepo);
          if (root) {
            currentRepo = root;
          }
          return {
            root: root ?? currentRepo,
            isRepo: root !== null,
          };
        },
        getReview: async ({ compare }) => {
          return git.getReview(currentRepo, compare);
        },
        stage: async ({ paths }) => {
          await git.stage(currentRepo, paths);
          return git.getReview(currentRepo, {
            kind: 'working',
          });
        },
        unstage: async ({ paths }) => {
          await git.unstage(currentRepo, paths);
          return git.getReview(currentRepo, {
            kind: 'working',
          });
        },
        // Phase 4 — comments. Stubbed so the contract is complete.
        getComments: async () => [],
        saveComment: async () => [],
        resolveComment: async () => [],
        deleteComment: async () => [],
        exportMarkdown: async () => ({
          markdown: '',
          path: '',
        }),
      },
    },
  });
}

export type SupervisionRpcInstance = ReturnType<typeof createSupervisionRPC>;
