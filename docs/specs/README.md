# Behavior specs

This directory is the source of truth for how supervision's UI is supposed to
behave. Code and tests implement the spec; when they disagree, either the code
is wrong or the spec needs an amendment — never silent drift.

## Spec format

Each spec file covers one area (e.g. `diff-navigation.md`). Behaviors are
numbered items grouped by sub-area:

- **ID**: `AREA-N` (e.g. `EXP-7`). IDs are permanent — never renumber or reuse.
  A withdrawn behavior keeps its row with a ~~struck-through~~ statement and a
  note pointing at what replaced it.
- **Statement**: one normative MUST-sentence describing observable behavior.
  Implementation details belong in *Notes*, not the statement.
- **Covered by**: how the item is enforced —
  - `unit` — a `bun test` test whose title contains the ID,
  - `e2e` — a Playwright test whose title contains the ID,
  - `structural` — a code-shape invariant that automation can't exercise
    (enforced by review; the spec row says what to look for),
  - `manual` — needs a human (used sparingly; say what to do),
  - `planned:unit` / `planned:e2e` — written but not yet covered (only
    acceptable while the covering milestone is in flight).

Traceability is grep-based and must stay that way:

```bash
grep -rn "EXP-7" src tests   # at least one test title must match
```

`scripts/check-spec-coverage.ts` automates that check across every ID.

## Workflow: every bug becomes a spec-tagged test

1. **Locate the spec item** the bug violates. If none exists, the bug found a
   hole in the spec — add a new item (next free number in its area) first.
2. **Write a failing test** titled with the ID, reproducing the report (same
   fixture shape, same input path — keyboard vs mouse matters).
3. **Fix** until the suite is green.
4. The test stays forever; the spec row's *Covered by* cell names it.

No fix lands without step 2. "I verified it manually" is how the diff-pane
regressions of June 2026 kept escaping.

## Running the suites

```bash
devbox run -- bun run test:unit      # pure model tests (bun test)
devbox run -- bun run test:e2e      # Playwright, webkit + chromium
devbox run -- bun run test          # typecheck + unit + e2e
```

E2e tests drive the real app in web mode (`/web.html`, see
`src/mainview/web/`) — same components, same store, same diff renderer as the
desktop app; only the platform backend (fixtures or the live bridge) differs.
