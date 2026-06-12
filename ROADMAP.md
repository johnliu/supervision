# Roadmap

Forward-looking work, not yet built. Each entry notes the rough shape and the
pieces it touches so it can be picked up cleanly.

## Up next

(Nothing queued — pick from the follow-ups below.)

## Possible follow-ups

- **Compare against a branch without checking out.** The footer's branch menu
  now *switches* (`git switch`); a complementary picker in the history tab
  could feed `compare: range` instead (review `main..feature` from any
  checkout, no switch needed — the `range` plumbing already exists).

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
