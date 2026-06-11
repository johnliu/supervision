import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveLaunchRepo } from './launchTarget';

const dir = mkdtempSync(path.join(tmpdir(), 'supervision-launch-'));
const file = path.join(dir, 'not-a-dir.txt');
writeFileSync(file, '');

describe('resolveLaunchRepo', () => {
  test('CLI-1: a positional directory argument wins', () => {
    expect(
      resolveLaunchRepo(
        [
          'bun',
          'index.js',
          dir,
        ],
        {
          SUPERVISION_REPO: '/elsewhere',
        },
      ),
    ).toBe(dir);
  });

  test('CLI-2: flags and non-directories are skipped', () => {
    expect(
      resolveLaunchRepo(
        [
          'bun',
          'index.js',
          '-psn_0_12345',
          file,
          dir,
        ],
        {},
      ),
    ).toBe(dir);
  });

  test('CLI-3: falls back to SUPERVISION_REPO, then cwd', () => {
    expect(
      resolveLaunchRepo(
        [
          'bun',
          'index.js',
        ],
        {
          SUPERVISION_REPO: dir,
        },
      ),
    ).toBe(dir);
    expect(
      resolveLaunchRepo(
        [
          'bun',
          'index.js',
        ],
        {},
      ),
    ).toBe(process.cwd());
  });
});
