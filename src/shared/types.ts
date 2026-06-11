// Domain types shared between the Bun main process and the webview UI.
// These are type-only and erase at build time, so importing them from either
// side is free of runtime cost.

/** What we are comparing. `working` is the default LLM-loop mode. */
export type CompareSpec =
  | {
      kind: 'working';
    } // working tree vs HEAD: staged + unstaged + untracked
  | {
      kind: 'commit';
      ref: string;
    } // a commit vs its parent
  | {
      kind: 'range';
      base: string;
      /** A ref, or null for the working tree as the newer endpoint. */
      head: string | null;
    }; // base..head (branch vs branch, commit vs working tree, etc.)

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export type AnnotationSide = 'additions' | 'deletions';

export interface FileChange {
  /** Path relative to the repo root (the new path for renames). */
  path: string;
  /** Previous path, present only for renames. */
  oldPath?: string;
  status: FileStatus;
  /** Old/new full file contents, fed to <MultiFileDiff/> (enables context
   * expansion). Empty string means the file is absent on that side — or that
   * the file is binary, in which case contents are omitted (see `binary`). */
  oldContents: string;
  newContents: string;
  additions: number;
  deletions: number;
  /** True when git reports the file as binary. Contents are not read or sent;
   * the UI shows a placeholder instead of a diff. */
  binary: boolean;
  /** True when this entry is the staged (already-approved) side of the file. */
  staged: boolean;
  /** True for untracked (new, never-added) files. */
  untracked: boolean;
}

/** Identity of the repo under review, shown in the sidebar footer. */
export interface RepoInfo {
  /** Git root under review (a linked worktree's own root when applicable). */
  root: string;
  /** Main repository root — equals `root` outside linked worktrees. */
  projectRoot: string;
  /** Checked-out branch, a short detached-HEAD sha, or null (no commits). */
  branch: string | null;
  /** Linked-worktree name (basename of `root`); null in the main checkout. */
  worktree: string | null;
}

export interface ReviewModel {
  repoRoot: string;
  compare: CompareSpec;
  /** Working mode: files with staged content. Ref mode: files flagged viewed. */
  reviewed: FileChange[];
  /** Working mode: files with unstaged or untracked content. Ref mode: the rest. */
  unreviewed: FileChange[];
}

/** One commit in the history panel (newest-first `git log` order). */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  /** ISO-8601 author date. */
  authorDate: string;
}

export interface Comment {
  id: string;
  path: string;
  /** Start line of the comment (the anchor). For a single-line comment this is
   * the only line. `line`/`side` stay the anchor for backward compatibility. */
  line: number;
  side: AnnotationSide;
  /** Inclusive end line of a multi-line selection; absent for single-line. */
  endLine?: number;
  endSide?: AnnotationSide;
  body: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

/** Shape of `.supervision/comments.json` — the source of truth + skill input. */
export interface CommentsFile {
  version: 1;
  repo: string;
  comments: Comment[];
}

/** User preferences persisted to `.supervision/config.json`. */
export interface SupervisionConfig {
  diffStyle: 'split' | 'unified';
  ignoreWhitespace: boolean;
  /** Wrap long lines in the diff instead of scrolling horizontally. */
  lineWrap: boolean;
  /** Diff font size in pixels (see shared/config.ts for bounds). */
  fontSize: number;
}

/**
 * Result of pointing the app at a different repo. On success carries the
 * resolved git root and the updated recent-projects list; on failure either an
 * error (not a git repo) or `cancelled` (the user dismissed the file dialog).
 */
export type SetRepoResult =
  | {
      ok: true;
      root: string;
      recents: string[];
    }
  | {
      ok: false;
      error?: string;
      cancelled?: boolean;
    };
