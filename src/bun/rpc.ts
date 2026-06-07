// Bun side of the typed RPC. Owns the "current repo" the UI is reviewing and
// exposes git + comment operations to the webview.

import path from 'node:path';
import { BrowserView, Utils } from 'electrobun/bun';
import type { SupervisionRPC } from '../shared/rpc';
import type { SetRepoResult } from '../shared/types';
import * as comments from './comments';
import * as config from './config';
import * as git from './git';
import * as recent from './recent';

/** The repo under review. Defaults to an env override, else the launch cwd. */
let currentRepo = process.env.SUPERVISION_REPO ?? process.cwd();

export function getCurrentRepo(): string {
  return currentRepo;
}

/** Resolve the git root (comments live there), falling back to currentRepo. */
async function repoRoot(): Promise<string> {
  return (await git.getRepoRoot(currentRepo)) ?? currentRepo;
}

export interface SupervisionRpcOptions {
  /** Called after a successful repo switch with the new git root and recents,
   * so the host can restart the watcher and push `repoChanged` to the webview. */
  onRepoChanged?: (info: { root: string; recents: string[] }) => void;
}

export function createSupervisionRPC(options: SupervisionRpcOptions = {}) {
  // Point the app at `target`'s git root: update currentRepo, record it as a
  // recent project, and notify the host (watcher restart + webview push). Errors
  // (not a repo) come back as data so the UI can surface them.
  const switchRepo = async (target: string): Promise<SetRepoResult> => {
    const root = await git.getRepoRoot(target);
    if (!root) {
      return {
        ok: false,
        error: `Not a git repository: ${target}`,
      };
    }
    currentRepo = root;
    const recents = await recent.addRecentProject(root);
    options.onRepoChanged?.({
      root,
      recents,
    });
    return {
      ok: true,
      root,
      recents,
    };
  };

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
        getReview: async ({ compare }) => git.getReview(currentRepo, compare),
        stage: async ({ paths }) => {
          // git resolves the repo-relative paths against cwd, so stage/unstage
          // must run at the git root — not a subdir currentRepo (the reason the
          // dev app used to need SUPERVISION_REPO).
          const root = await repoRoot();
          await git.stage(root, paths);
          return git.getReview(root, {
            kind: 'working',
          });
        },
        unstage: async ({ paths }) => {
          const root = await repoRoot();
          await git.unstage(root, paths);
          return git.getReview(root, {
            kind: 'working',
          });
        },
        getComments: async () => comments.readComments(await repoRoot()),
        saveComment: async (input) => comments.addComment(await repoRoot(), input),
        resolveComment: async ({ id }) => comments.resolveComment(await repoRoot(), id),
        deleteComment: async ({ id }) => comments.deleteComment(await repoRoot(), id),
        exportMarkdown: async () => {
          const result = await comments.exportMarkdown(await repoRoot());
          // Copy on the Bun side — navigator.clipboard is unreliable in a webview.
          try {
            Utils.clipboardWriteText(result.markdown);
          } catch (error) {
            console.error('clipboardWriteText failed', error);
          }
          return result;
        },
        getConfig: async () => config.readConfig(await repoRoot()),
        saveConfig: async (input) => config.writeConfig(await repoRoot(), input),
        setRepo: async ({ path: target }) => switchRepo(target),
        openProject: async () => {
          const picked = await Utils.openFileDialog({
            startingFolder: path.dirname(currentRepo),
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
          });
          const chosen = picked.find((entry) => entry.trim().length > 0);
          if (!chosen) {
            return {
              ok: false,
              cancelled: true,
            };
          }
          return switchRepo(chosen);
        },
        getRecentProjects: async () => recent.readRecentProjects(),
      },
    },
  });
}

export type SupervisionRpcInstance = ReturnType<typeof createSupervisionRPC>;
