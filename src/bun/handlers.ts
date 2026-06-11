// Transport-agnostic implementation of the SupervisionRPC request handlers.
// Owns the "current repo" state. Consumed by two transports:
//   - src/bun/rpc.ts        — Electrobun RPC (the desktop app)
//   - src/bun/webBridge.ts  — plain-JSON WebSocket (web mode, dev only)
// Native operations (clipboard, folder picker) are injected; transports
// without them degrade gracefully.

import type { SupervisionRPC } from '../shared/rpc';
import type { SetRepoResult } from '../shared/types';
import * as comments from './comments';
import * as config from './config';
import * as git from './git';
import { resolveLaunchRepo } from './launchTarget';
import * as recent from './recent';

type BunRequests = SupervisionRPC['bun']['requests'];

export type SupervisionRequestHandlers = {
  [K in keyof BunRequests]: (params: BunRequests[K]['params']) => Promise<BunRequests[K]['response']>;
};

export interface NativeOps {
  /** Copy text to the system clipboard (exportMarkdown). */
  clipboardWriteText?: (text: string) => void;
  /** Open a native folder picker; resolve null when cancelled (openProject). */
  openFolderDialog?: (startingFolder: string) => Promise<string | null>;
}

export interface SupervisionHandlersOptions {
  /** Called after a successful repo switch with the new git root and recents,
   * so the host can restart the watcher and push `repoChanged`. */
  onRepoChanged?: (info: { root: string; recents: string[] }) => void;
  native?: NativeOps;
}

export interface SupervisionHandlers {
  handlers: SupervisionRequestHandlers;
  getCurrentRepo(): string;
}

export function createSupervisionHandlers(options: SupervisionHandlersOptions = {}): SupervisionHandlers {
  /** The repo under review: CLI directory arg, else env override, else cwd. */
  let currentRepo = resolveLaunchRepo();

  /** Resolve the git root (comments live there), falling back to currentRepo. */
  const repoRoot = async (): Promise<string> => (await git.getRepoRoot(currentRepo)) ?? currentRepo;

  // Point the app at `target`'s git root: update currentRepo, record it as a
  // recent project, and notify the host (watcher restart + push). Errors
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

  const handlers: SupervisionRequestHandlers = {
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
    getLog: async () => git.getLog(currentRepo),
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
      // Copy on the host side when the transport has a clipboard —
      // navigator.clipboard is unreliable in the Electrobun webview.
      try {
        options.native?.clipboardWriteText?.(result.markdown);
      } catch (error) {
        console.error('clipboardWriteText failed', error);
      }
      return result;
    },
    getConfig: async () => config.readConfig(await repoRoot()),
    saveConfig: async (input) => config.writeConfig(await repoRoot(), input),
    setRepo: async ({ path: target }) => switchRepo(target),
    openProject: async () => {
      if (!options.native?.openFolderDialog) {
        return {
          ok: false,
          cancelled: true,
        };
      }
      const chosen = await options.native.openFolderDialog(currentRepo);
      if (!chosen) {
        return {
          ok: false,
          cancelled: true,
        };
      }
      return switchRepo(chosen);
    },
    getRecentProjects: async () => recent.readRecentProjects(),
  };

  return {
    handlers,
    getCurrentRepo: () => currentRepo,
  };
}
