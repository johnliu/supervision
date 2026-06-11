// Install the supervision skill (`/supervision`) for Claude Code. The repo's
// skills/supervision/SKILL.md is the single source of truth: Bun inlines it
// here at build time (text import — verified to survive `bun build`), and
// installing writes it to the user-level skills directory, where Claude Code
// picks it up in every project.

import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
// tsc types this via the ambient '*.md' declaration (src/types/shims.d.ts);
// Bun resolves it to the file's contents.
import skillMarkdown from '../../skills/supervision/SKILL.md' with { type: 'text' };
import type { SkillStatus } from '../shared/types';

const SKILL_TEXT: string = skillMarkdown;

function skillPath(): string {
  return path.join(homedir(), '.claude', 'skills', 'supervision', 'SKILL.md');
}

export async function getSkillStatus(): Promise<SkillStatus> {
  const file = Bun.file(skillPath());
  const installed = await file.exists();
  return {
    installed,
    upToDate: installed && (await file.text()) === SKILL_TEXT,
    path: skillPath(),
  };
}

export async function installSkill(): Promise<SkillStatus> {
  await mkdir(path.dirname(skillPath()), {
    recursive: true,
  });
  await Bun.write(skillPath(), SKILL_TEXT);
  // The skill was briefly named supervision-feedback; an installed copy under
  // that name would register as a duplicate skill, so installing cleans it up.
  await rm(path.join(homedir(), '.claude', 'skills', 'supervision-feedback'), {
    recursive: true,
    force: true,
  });
  return getSkillStatus();
}
