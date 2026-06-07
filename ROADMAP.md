# Roadmap

Forward-looking work, not yet built. Each entry notes the rough shape and the
pieces it touches so it can be picked up cleanly.

_Nothing is currently queued — the previously-listed items (Cmd+K quick-open,
Settings + persistence, project selection, and hunk navigation) are all
implemented. The notes below are optional follow-ups, not commitments._

## Possible follow-ups

- **Hunk navigation coverage.** `]` / `[` (in `DiffPane.tsx`) are DOM-based, so
  they target the *rendered* change blocks on the new/additions side. A
  deletion-only hunk (no added line) and any hunk virtualized off-screen aren't
  landed on. A data-driven version — computing hunk boundaries from the diff
  (e.g. a Bun-side `getHunks(path)` from `git diff -U0`, or the parsed hunks from
  `@pierre/diffs`) — would cover both and survive virtualization.
