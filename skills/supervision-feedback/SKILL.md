---
name: supervision-feedback
description: >-
  Apply code-review feedback left in Supervision. Use when the user asks to
  "address review comments", "apply supervision feedback", "respond to my
  review", or otherwise act on a `.supervision/comments.json` file in the repo.
---

# Supervision feedback

Supervision (a local code-review tool) records review comments at
`.supervision/comments.json` in the repo root. Each open comment is an
actionable instruction anchored to a file and line. This skill reads those
comments, applies the requested changes, and marks them resolved.

## The contract

`.supervision/comments.json`:

```json
{
  "version": 1,
  "repo": "/abs/path/to/repo",
  "comments": [
    {
      "id": "uuid",
      "path": "src/foo.ts",
      "line": 42,
      "side": "additions",
      "endLine": 45,
      "endSide": "additions",
      "body": "extract this into a helper",
      "status": "open",
      "createdAt": "2026-06-05T09:00:00.000Z"
    }
  ]
}
```

- `path` is relative to the repo root; `line` is the line number on the given
  `side` (`additions` = the new/right side of the diff, `deletions` = the
  old/left side). For most "change this" comments, treat `additions` line
  numbers as the current file's line numbers.
- `endLine`/`endSide` are optional. When `endLine` is present the comment spans
  `line`..`endLine` (inclusive); treat the whole range as the target. When they
  are absent the comment is anchored to the single `line`.
- Only act on comments with `"status": "open"`. Ignore `"resolved"` ones.

## Steps

1. Read `.supervision/comments.json` from the repo root. If it is missing or
   has no `open` comments, tell the user there is nothing to address and stop.
2. Group the open comments by `path`. For each file, open it and locate each
   comment's `line`.
3. Make the change the comment body requests. Keep edits minimal and scoped to
   the feedback; do not opportunistically refactor unrelated code.
4. After successfully applying a comment, set its `status` to `"resolved"` in
   `.supervision/comments.json` (preserve every other field and the file
   shape). If you cannot or should not apply a comment, leave it `open` and
   note why to the user.
5. Summarize what you changed, grouped by file, and list any comments you left
   open with the reason.

## Notes

- The user reviews iteratively: they stage (approve) changes they like in
  Supervision, then re-run their agent. Re-read `comments.json` each run —
  it is the source of truth.
- Do not delete comments; only flip `open` → `resolved`. The user may want to
  see resolved history in Supervision.
- If a `line` no longer matches because the file moved on, use the comment
  `body` and surrounding context to find the right spot; if you truly cannot,
  leave it open and say so.
