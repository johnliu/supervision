# Roadmap

Forward-looking work, not yet built. Each entry notes the rough shape and the
pieces it touches so it can be picked up cleanly.

## Up next

- **Comment anchoring (SHA / staleness).** A comment pins a line number, but
  the file keeps moving — after a few agent iterations the anchor may point at
  the wrong code, and nothing says so. Record context at creation time in
  `comments.json`: the working-tree-relative state it was made against (HEAD
  sha plus the file's blob sha, both cheap via `git rev-parse HEAD` and
  `git hash-object <file>` in `src/bun/comments.ts`). On read, compare the
  stored blob sha to the current file: unchanged → anchor exact; changed →
  mark the comment *stale* in the UI (badge in `CommentThread` / the Comments
  tab) and optionally re-anchor by diffing the stored line's neighborhood
  against the new contents (the parsed diff from `@pierre/diffs` already has
  the machinery). The skill contract would tell agents to leave `status`
  untouched but refresh the anchor when they edit the commented region.

- **Theme support.** The palette already flows through CSS custom properties
  (`index.css`), the tree restyles via `--trees-*-override` (`Sidebar.tsx`),
  and the diff takes a theme pair (`THEME` in `DiffPane.tsx`, currently pinned
  `themeType: 'dark'`). Theme = a `SupervisionConfig` field (`'dark' | 'light'
  | 'system'`) driving: a class on `<html>` for the app palette, `themeType`
  for the diff, and `themeToTreeStyles({ type })` for the tree. `system`
  listens to `prefers-color-scheme`. The settings dialog gets a three-way
  toggle group.

- **Worktree & branch support.** The footer now *names* the worktree and
  branch (`getRepoInfo`); the next step is switching, not just showing. Shape:
  `git worktree list --porcelain` + `git branch --list` behind one RPC; the
  project switcher grows a "Worktrees" section (jump between checkouts of the
  same project — each is just a `setRepo` to that root) and the history tab a
  branch picker that feeds `compare: range` (review `main..feature` without
  checking out). Pairs naturally with the agent flow where each task runs in
  its own worktree.

## Possible follow-ups

- **Live comment reload.** The watcher deliberately ignores `.supervision/`
  (see `IGNORED_SEGMENTS` in `src/bun/watcher.ts`), so an agent's responses
  written to `comments.json` only show up with the next refresh — today that
  rides along with the agent's code edits, which trigger the working-tree
  watcher anyway. A dedicated watch on `comments.json` would surface
  response-only updates (e.g. "won't fix" replies with no code change)
  immediately.
