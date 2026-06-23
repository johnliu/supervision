// Transport-agnostic implementation of the SupervisionRPC request handlers.
// Owns the "current repo" state. Consumed by two transports:
//   - src/bun/rpc.ts        — Electrobun RPC (the desktop app)
//   - src/bun/webBridge.ts  — plain-JSON WebSocket (web mode, dev only)
// Native operations (clipboard, folder picker) are injected; transports
// without them degrade gracefully.

import type { SupervisionRPC } from '../shared/rpc';
import type { ReviewModel, SetRepoResult } from '../shared/types';
import * as comments from './comments';
import * as config from './config';
import * as editor from './editor';
import * as git from './git';
import { resolveInitialRepo } from './launchTarget';
import * as recent from './recent';
import * as skill from './skill';

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
  /** The launch/selected repo once initial resolution has settled (null = no
   * project open). Async because resolution reads recents and probes git. */
  getCurrentRepo(): Promise<string | null>;
}

/** An empty working-tree review — the response shape for "no project open". */
function emptyReview(): ReviewModel {
  return {
    repoRoot: '',
    compare: {
      kind: 'working',
    },
    reviewed: [],
    unreviewed: [],
  };
}

export function createSupervisionHandlers(options: SupervisionHandlersOptions = {}): SupervisionHandlers {
  /**
   * The repo under review, or null when no project is open (a bare launch with
   * no git repo at the cwd and no usable recent). Resolved once on startup —
   * the resolution reads recents and probes git, both async — and memoized via
   * `ready`; every handler reads the repo through `current()` so none races
   * ahead of that resolution.
   */
  let currentRepo: string | null = null;
  const ready: Promise<void> = (async () => {
    currentRepo = await resolveInitialRepo({
      isRepo: async (dir) => (await git.getRepoRoot(dir)) !== null,
      readRecents: recent.readRecentProjects,
    });
  })();

  /** The current repo once initial resolution has settled (null = no project). */
  const current = async (): Promise<string | null> => {
    await ready;
    return currentRepo;
  };

  /** Resolve the git root (comments live there) for the current repo, or null
   * when no project is open. */
  const repoRoot = async (): Promise<string | null> => {
    const repo = await current();
    if (!repo) {
      return null;
    }
    return (await git.getRepoRoot(repo)) ?? repo;
  };

  // Point the app at `target`'s git root: update currentRepo, record its
  // PROJECT (the main checkout — recents are per-project, never per-worktree)
  // and notify the host (watcher restart + push). Errors (not a repo) come
  // back as data so the UI can surface them.
  const switchRepo = async (target: string): Promise<SetRepoResult> => {
    const root = await git.getRepoRoot(target);
    if (!root) {
      return {
        ok: false,
        error: `Not a git repository: ${target}`,
      };
    }
    currentRepo = root;
    const recents = await recent.addRecentProject((await git.getRepoInfo(root)).projectRoot);
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
      const repo = await current();
      if (!repo) {
        return {
          root: '',
          isRepo: false,
        };
      }
      const root = await git.getRepoRoot(repo);
      if (root) {
        currentRepo = root;
      }
      return {
        root: root ?? repo,
        isRepo: root !== null,
      };
    },
    getReview: async ({ compare, ignoreWhitespace }) => {
      const repo = await current();
      // No project open: an empty review rather than the not-a-git-repo throw,
      // which would surface as an error banner. repoRoot '' is the signal the
      // webview renders its "no project" empty state from.
      return repo
        ? git.getReview(repo, compare, ignoreWhitespace)
        : {
            ...emptyReview(),
            compare,
          };
    },
    getLog: async () => {
      const repo = await current();
      return repo ? git.getLog(repo) : [];
    },
    getCommit: async ({ ref }) => {
      const repo = await current();
      return repo ? git.getCommitDetails(repo, ref) : null;
    },
    getRangeLog: async ({ base, head }) => {
      const repo = await current();
      return repo ? git.getRangeLog(repo, base, head) : [];
    },
    readFile: async ({ path: relPath, ref }) => {
      const repo = await current();
      return repo
        ? git.readFileBase64(repo, relPath, ref)
        : {
            ok: false,
            error: 'No project open',
          };
    },
    stage: async ({ paths, ignoreWhitespace }) => {
      // git resolves the repo-relative paths against cwd, so stage/unstage
      // must run at the git root — not a subdir currentRepo (the reason the
      // dev app used to need SUPERVISION_REPO).
      const root = await repoRoot();
      if (!root) {
        return emptyReview();
      }
      await git.stage(root, paths);
      return git.getReview(
        root,
        {
          kind: 'working',
        },
        ignoreWhitespace,
      );
    },
    unstage: async ({ paths, ignoreWhitespace }) => {
      const root = await repoRoot();
      if (!root) {
        return emptyReview();
      }
      await git.unstage(root, paths);
      return git.getReview(
        root,
        {
          kind: 'working',
        },
        ignoreWhitespace,
      );
    },
    getComments: async () => {
      const root = await repoRoot();
      return root ? comments.readComments(root) : [];
    },
    saveComment: async (input) => {
      const root = await repoRoot();
      return root ? comments.addComment(root, input) : [];
    },
    resolveComment: async ({ id }) => {
      const root = await repoRoot();
      return root ? comments.resolveComment(root, id) : [];
    },
    replyToComment: async ({ id, body }) => {
      const root = await repoRoot();
      return root ? comments.replyToComment(root, id, body) : [];
    },
    deleteComment: async ({ id }) => {
      const root = await repoRoot();
      return root ? comments.deleteComment(root, id) : [];
    },
    clearComments: async ({ status }) => {
      const root = await repoRoot();
      return root ? comments.clearComments(root, status) : [];
    },
    exportMarkdown: async () => {
      const root = await repoRoot();
      const result = root
        ? await comments.exportMarkdown(root)
        : {
            markdown: '',
            path: '',
          };
      // Copy on the host side when the transport has a clipboard —
      // navigator.clipboard is unreliable in the Electrobun webview.
      try {
        options.native?.clipboardWriteText?.(result.markdown);
      } catch (error) {
        console.error('clipboardWriteText failed', error);
      }
      return result;
    },
    // Config is user-level; the repo root is only passed so a legacy
    // per-repo config can seed the user file on first read.
    getConfig: async () => config.readConfig((await repoRoot()) ?? undefined),
    saveConfig: async (input) => config.writeConfig(input),
    setRepo: async ({ path: target }) => switchRepo(target),
    openProject: async () => {
      if (!options.native?.openFolderDialog) {
        return {
          ok: false,
          cancelled: true,
        };
      }
      // Start the picker at the current repo; '' lets the native layer fall
      // back to a sensible default (home) when no project is open.
      const chosen = await options.native.openFolderDialog((await current()) ?? '');
      if (!chosen) {
        return {
          ok: false,
          cancelled: true,
        };
      }
      return switchRepo(chosen);
    },
    // Recents list project ROOTS only. Entries written before that rule (or
    // whose checkout moved/vanished) are normalized through git on read:
    // worktree paths collapse into their project, dead paths drop out.
    getRecentProjects: async () => {
      const entries = await recent.readRecentProjects();
      const projects: string[] = [];
      for (const entry of entries) {
        const root = await git.getRepoRoot(entry);
        if (!root) {
          continue;
        }
        const { projectRoot } = await git.getRepoInfo(root);
        if (!projects.includes(projectRoot)) {
          projects.push(projectRoot);
        }
      }
      if (projects.length !== entries.length || projects.some((entry, i) => entry !== entries[i])) {
        await recent.writeRecentProjects(projects);
      }
      return projects;
    },
    getRepoInfo: async () => {
      const repo = await current();
      return repo
        ? git.getRepoInfo(repo)
        : {
            root: '',
            projectRoot: '',
            branch: null,
            worktree: null,
          };
    },
    getWorktrees: async () => {
      const repo = await current();
      return repo ? git.listWorktrees(repo) : [];
    },
    getBranches: async () => {
      const repo = await current();
      return repo ? git.listBranches(repo) : [];
    },
    switchBranch: async ({ name }) => {
      const repo = await current();
      return repo
        ? git.switchBranch(repo, name)
        : {
            ok: false,
            error: 'No project open',
          };
    },
    getSkillStatus: async () => skill.getSkillStatus(),
    installSkill: async () => skill.installSkill(),
    openInEditor: async ({ path: relPath, line }) => {
      const root = await repoRoot();
      if (!root) {
        return {
          ok: false,
          error: 'No project open',
        };
      }
      return editor.openInEditor(root, relPath, line, (await config.readConfig(root)).editor);
    },
  };

  return {
    handlers,
    getCurrentRepo: () => current(),
  };
}
