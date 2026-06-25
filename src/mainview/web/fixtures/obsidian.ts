import { makeFileChange } from './builders';
import type { FixtureData } from './types';

const OLD_NOTE = `# Project plan

Some intro.

> [!note]
> Original reminder.

Hello world.
`;

const NEW_NOTE = `---
title: Plan
tags: [a, b]
---

# Project plan

Some intro.

> [!warning] Heads up
> Don't merge before Friday.

Hello ==bright== world.

See [[Other Note|the other one]].

\`\`\`mermaid
graph LR
A --> B
B --> C
\`\`\`
`;

export function obsidian(): FixtureData {
  return {
    id: 'obsidian',
    model: {
      repoRoot: 'fixture://obsidian',
      compare: {
        kind: 'working',
      },
      reviewed: [],
      unreviewed: [
        makeFileChange({
          path: 'docs/plan.md',
          // joinContents appends a trailing newline; strip our own first.
          oldLines: OLD_NOTE.replace(/\n$/, '').split('\n'),
          newLines: NEW_NOTE.replace(/\n$/, '').split('\n'),
        }),
      ],
    },
    comments: [],
    config: {
      diffStyle: 'split',
      ignoreWhitespace: false,
    },
  };
}
