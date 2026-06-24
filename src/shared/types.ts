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
  /** Old/new full file contents, fed to the diff viewer (enables context
   * expansion and supplies the line text). Empty string means the file is
   * absent on that side — or that the file is binary, in which case contents
   * are omitted (see `binary`). */
  oldContents: string;
  newContents: string;
  /** git's own unified diff for this file (hunks only, default context). The
   * client parses it with `processFile`, supplying the contents above — git
   * computes the diff in C, replacing the client-side Myers diff that blew up
   * superlinearly with edit distance and froze the UI on large/heavily-changed
   * files. Empty for binary files (see `binary`). */
  patch: string;
  additions: number;
  deletions: number;
  /** True when git reports the file as binary. Contents are not read or sent;
   * the UI shows a placeholder instead of a diff. */
  binary: boolean;
  /** True when this entry is the staged (already-approved) side of the file. */
  staged: boolean;
  /** True for untracked (new, never-added) files. */
  untracked: boolean;
  /** Derived on read, never persisted on the FileChange: the reviewer marked
   * this file read and its shown content is unchanged since. Content-addressed
   * — `.supervision/read.json` stores a hash of the new-side bytes
   * (`newContents`), so any edit silently clears it (see bun/readState.ts). */
  read: boolean;
}

/** Install state of the Claude Code feedback skill (user-level). */
export interface SkillStatus {
  installed: boolean;
  /** The installed copy matches the version bundled with this build. */
  upToDate: boolean;
  path: string;
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

/** One checkout of the project (`git worktree list`). */
export interface WorktreeInfo {
  /** Absolute path of the worktree's root. */
  path: string;
  /** Checked-out branch, or null when detached. */
  branch: string | null;
  /** True for the worktree currently under review. */
  current: boolean;
  /** True for the main checkout (always listed first by git). */
  main: boolean;
}

/** One local branch (`refs/heads`), newest commit first. */
export interface BranchInfo {
  name: string;
  /** Checked out in the worktree under review. */
  current: boolean;
  /** Root of ANOTHER worktree that has this branch checked out (git refuses
   * to switch to it here), or null when the branch is free to switch to. */
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

/** Full details of one commit (the commit-details view). */
export interface CommitDetails {
  hash: string;
  shortHash: string;
  /** First line of the commit message. */
  subject: string;
  /** Message body after the subject line; '' when the message is one line. */
  body: string;
  authorName: string;
  authorEmail: string;
  /** ISO-8601 author date. */
  authorDate: string;
}

/**
 * Raw bytes of a repo file, base64-encoded for inline preview (images). The
 * mime type is derived from the file extension on the Bun side.
 */
export type FilePayload =
  | {
      ok: true;
      mime: string;
      base64: string;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * The repo state a comment's line numbers were recorded against. Captured at
 * creation; the feedback skill refreshes it when it moves the commented code.
 * Either sha may be null: `head` in a repo with no commits, `blob` when the
 * file is absent from the working tree (e.g. a comment on a deleted file).
 */
export interface CommentAnchor {
  /** `git rev-parse HEAD` at the time the anchor was recorded. */
  head: string | null;
  /** `git hash-object <path>` of the working-tree file at that time. */
  blob: string | null;
}

/** One reply in the thread under a comment. */
export interface CommentReply {
  id: string;
  /** 'agent' = written by the feedback skill; 'user' = the reviewer. */
  author: 'agent' | 'user';
  body: string;
  createdAt: string;
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
  /** Legacy single agent reply. Still accepted from older skills, but folded
   * into `replies` on read — app code only ever sees `replies`. */
  response?: string;
  /** The conversation under the comment, oldest first. */
  replies?: CommentReply[];
  /** Repo state the line numbers point into; absent on pre-anchor comments. */
  anchor?: CommentAnchor;
  /** Derived on read, never persisted: the file changed since the anchor was
   * recorded, so the line numbers may no longer point at the commented code. */
  stale?: boolean;
}

/** Shape of `.supervision/comments.json` — the source of truth + skill input. */
export interface CommentsFile {
  version: 1;
  repo: string;
  comments: Comment[];
}

/** Editors "Open in editor" can target (see EDITORS in shared/config.ts). */
export type EditorId = 'open' | 'cursor' | 'code' | 'zed' | 'subl';

/** Theme preference; 'system' follows the OS via prefers-color-scheme. */
export type ThemePreference = 'dark' | 'light' | 'system';

/** shadcn base-color family for the UI's grays (see PALETTES in
 * shared/config.ts). 'olive' is the app's original warm-green tint. */
export type PaletteId = 'olive' | 'stone' | 'zinc' | 'gray' | 'slate' | 'neutral';

/** Syntax-highlighting theme pair for the diff (see DIFF_THEMES). */
export type DiffThemeId =
  | 'pierre'
  | 'pierre-soft'
  | 'github'
  | 'one'
  | 'catppuccin'
  | 'vitesse'
  | 'solarized'
  | 'gruvbox'
  | 'everforest';

/** User preferences persisted app-wide to `~/.supervision/config.json`. */
export interface SupervisionConfig {
  diffStyle: 'split' | 'unified';
  ignoreWhitespace: boolean;
  /** Wrap long lines in the diff instead of scrolling horizontally. */
  lineWrap: boolean;
  /** Diff font size in pixels (see shared/config.ts for bounds). */
  fontSize: number;
  /** Where "Open in editor" sends files ('open' = system default app). */
  editor: EditorId;
  /** App palette + diff theme + tree theme, applied together. */
  theme: ThemePreference;
  /** shadcn base-color family tinting every gray in the UI. */
  palette: PaletteId;
  /** Shiki theme pair the diff highlights with (dark/light per `theme`). */
  diffTheme: DiffThemeId;
  /** First-launch onboarding finished (or skipped). A config file written
   * before this flag existed counts as onboarded — see bun/config.ts. */
  onboarded: boolean;
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
