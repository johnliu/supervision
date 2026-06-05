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
      head: string;
    }; // base..head (branch vs branch, etc.)

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export type AnnotationSide = 'additions' | 'deletions';

export interface FileChange {
  /** Path relative to the repo root (the new path for renames). */
  path: string;
  /** Previous path, present only for renames. */
  oldPath?: string;
  status: FileStatus;
  /** A single-file unified diff, fed directly to <PatchDiff patch=... />. */
  patch: string;
  additions: number;
  deletions: number;
  /** True when this entry is the staged (already-approved) side of the file. */
  staged: boolean;
  /** True for untracked (new, never-added) files. */
  untracked: boolean;
}

export interface ReviewModel {
  repoRoot: string;
  compare: CompareSpec;
  /** Working mode: files with staged content. Ref mode: files flagged viewed. */
  reviewed: FileChange[];
  /** Working mode: files with unstaged or untracked content. Ref mode: the rest. */
  unreviewed: FileChange[];
}

export interface Comment {
  id: string;
  path: string;
  line: number;
  side: AnnotationSide;
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
