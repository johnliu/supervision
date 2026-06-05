// Bun side of the typed RPC. Owns the "current repo" the UI is reviewing and
// exposes git + comment operations to the webview.

import { BrowserView } from 'electrobun/bun';
import type { SupervisionRPC } from '../shared/rpc';
import * as comments from './comments';
import * as git from './git';

/** The repo under review. Defaults to an env override, else the launch cwd. */
let currentRepo = process.env.SUPERVISION_REPO ?? process.cwd();

export function getCurrentRepo(): string {
  return currentRepo;
}

/** Resolve the git root (comments live there), falling back to currentRepo. */
async function repoRoot(): Promise<string> {
  return (await git.getRepoRoot(currentRepo)) ?? currentRepo;
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
        getComments: async () => comments.readComments(await repoRoot()),
        saveComment: async (input) => comments.addComment(await repoRoot(), input),
        resolveComment: async ({ id }) => comments.resolveComment(await repoRoot(), id),
        deleteComment: async ({ id }) => comments.deleteComment(await repoRoot(), id),
        exportMarkdown: async () => comments.exportMarkdown(await repoRoot()),
      },
    },
  });
}

export type SupervisionRpcInstance = ReturnType<typeof createSupervisionRPC>;
