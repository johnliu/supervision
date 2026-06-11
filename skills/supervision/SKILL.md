---
name: supervision
description: >-
  Apply code-review feedback left in Supervision. Use when the user invokes
  /supervision, asks to "address review comments", "apply supervision
  feedback", "respond to my review", or otherwise act on a
  `.supervision/comments.json` file in the repo.
---

# Supervision feedback

Supervision (a local code-review tool) records review comments at
`.supervision/comments.json` in the repo root. Each open comment is an
actionable instruction anchored to a file and line. This skill reads those
comments, applies the requested changes, and replies to each one directly in
the JSON — Supervision renders the `replies` thread inline under the comment.

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
      "status": "resolved",
      "createdAt": "2026-06-05T09:00:00.000Z",
      "replies": [
        {
          "id": "uuid",
          "author": "agent",
          "body": "Pulled the block into a computeRetryDelay() helper.",
          "createdAt": "2026-06-05T09:05:00.000Z"
        }
      ],
      "anchor": {
        "head": "<git rev-parse HEAD when the comment was made>",
        "blob": "<git hash-object src/foo.ts when the comment was made>"
      }
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
- `replies` is the conversation under the comment, oldest first. Entries with
  `"author": "user"` are the reviewer's follow-ups — read the whole thread
  before acting; a later reply may refine or override the original `body`.
- To respond, append (never rewrite or delete existing entries) a reply:
  `{ "id": "<new uuid>", "author": "agent", "body": "...", "createdAt":
  "<now, ISO-8601>" }`. One or two sentences on what you changed — or why you
  didn't — addressed to the reviewer. Always respond in the JSON itself;
  don't rely on chat output the reviewer may never see. (Older versions of
  this contract used a single `response` string; if you see one, leave it —
  Supervision folds it into `replies` on read.)
- `anchor` records the file state the line numbers point into: `head` is
  `git rev-parse HEAD` and `blob` is `git hash-object <path>` from when the
  comment was made (either may be null). Supervision compares `anchor.blob`
  to the current file on every read and flags drifted comments as *stale* in
  the UI. If `anchor.blob` no longer matches the file, don't trust `line`
  blindly — find the commented code by content before acting.

## Steps

1. Read `.supervision/comments.json` from the repo root. If it is missing or
   has no `open` comments, tell the user there is nothing to address and stop.
2. Group the open comments by `path`. For each file, open it and locate each
   comment's `line`.
3. Make the change the comment body requests. Keep edits minimal and scoped to
   the feedback; do not opportunistically refactor unrelated code.
4. After applying a comment, update it in `.supervision/comments.json`: set
   `"status"` to `"resolved"` and append an agent reply describing the change
   you made (preserve every other field and the file shape).
5. If you cannot or should not apply a comment, leave it `"open"` and append
   an agent reply explaining why, so the reviewer sees the reasoning in the
   app and can answer in the thread.
6. For any comment you leave `"open"` in a file you edited, keep its anchor
   honest — do not touch `status`, but update `line`/`endLine` to where the
   commented code now lives and refresh `anchor` (`blob` from
   `git hash-object <path>`, `head` from `git rev-parse HEAD`) so the comment
   doesn't show as stale pointing at the wrong lines.
