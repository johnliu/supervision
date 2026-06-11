# Roadmap

Forward-looking work, not yet built. Each entry notes the rough shape and the
pieces it touches so it can be picked up cleanly.

## Up next

- **Worktree & branch support.** The footer now *names* the worktree and
  branch (`getRepoInfo`); the next step is switching, not just showing. Shape:
  `git worktree list --porcelain` + `git branch --list` behind one RPC; the
  project switcher grows a "Worktrees" section (jump between checkouts of the
  same project — each is just a `setRepo` to that root) and the history tab a
  branch picker that feeds `compare: range` (review `main..feature` without
  checking out). Pairs naturally with the agent flow where each task runs in
  its own worktree.

## Possible follow-ups

- **Comment re-anchoring.** Comments now record an anchor (HEAD + blob sha)
  and read back as *stale* when the file drifts; the next step is moving the
  anchor instead of just flagging it — diff the stored line's neighborhood
  against the new contents (the parsed diff from `@pierre/diffs` already has
  the machinery) and update `line`/`endLine` automatically.

- **Live comment reload.** The watcher deliberately ignores `.supervision/`
  (see `IGNORED_SEGMENTS` in `src/bun/watcher.ts`), so an agent's responses
  written to `comments.json` only show up with the next refresh — today that
  rides along with the agent's code edits, which trigger the working-tree
  watcher anyway. A dedicated watch on `comments.json` would surface
  response-only updates (e.g. "won't fix" replies with no code change)
  immediately.
