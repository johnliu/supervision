import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveExplicitRepo, resolveInitialRepo } from './launchTarget';

const dir = mkdtempSync(path.join(tmpdir(), 'supervision-launch-'));
const file = path.join(dir, 'not-a-dir.txt');
writeFileSync(file, '');

const ARGV = [
  'bun',
  'index.js',
];

describe('resolveExplicitRepo', () => {
  test('CLI-1: a positional directory argument wins over SUPERVISION_REPO', () => {
    expect(
      resolveExplicitRepo(
        [
          ...ARGV,
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
      resolveExplicitRepo(
        [
          ...ARGV,
          '-psn_0_12345',
          file,
          dir,
        ],
        {},
      ),
    ).toBe(dir);
  });

  test('CLI-3: falls back to SUPERVISION_REPO, else null', () => {
    expect(
      resolveExplicitRepo(ARGV, {
        SUPERVISION_REPO: dir,
      }),
    ).toBe(dir);
    expect(resolveExplicitRepo(ARGV, {})).toBeNull();
  });
});

describe('resolveInitialRepo', () => {
  test('LAUNCH-1: an explicit target wins and is honored as-is (no git probing)', async () => {
    const probed: string[] = [];
    const result = await resolveInitialRepo({
      argv: ARGV,
      env: {
        SUPERVISION_REPO: '/explicit',
      },
      cwd: '/cwd',
      isRepo: async (probedDir) => {
        probed.push(probedDir);
        return true;
      },
      readRecents: async () => [
        '/recent',
      ],
    });
    expect(result).toBe('/explicit');
    expect(probed).toEqual([]);
  });

  test('LAUNCH-2: the launch cwd is used when it is a git repo', async () => {
    const result = await resolveInitialRepo({
      argv: ARGV,
      env: {},
      cwd: '/work/repo',
      isRepo: async (probedDir) => probedDir === '/work/repo',
      readRecents: async () => [
        '/recent',
      ],
    });
    expect(result).toBe('/work/repo');
  });

  test('LAUNCH-3: falls back to the most recent valid project when cwd is not a repo', async () => {
    // The Finder-launch case: cwd is the app bundle, never a repo.
    const result = await resolveInitialRepo({
      argv: ARGV,
      env: {},
      cwd: '/Applications/Supervision.app/Contents/MacOS',
      isRepo: async (probedDir) => probedDir === '/recent/b',
      readRecents: async () => [
        '/recent/a',
        '/recent/b',
      ],
    });
    expect(result).toBe('/recent/b');
  });

  test('LAUNCH-4: returns null when nothing resolves to a repo', async () => {
    const result = await resolveInitialRepo({
      argv: ARGV,
      env: {},
      cwd: '/Applications/Supervision.app/Contents/MacOS',
      isRepo: async () => false,
      readRecents: async () => [
        '/gone',
      ],
    });
    expect(result).toBeNull();
  });

  test('LAUNCH-5: the cwd repo is preferred over recents', async () => {
    const result = await resolveInitialRepo({
      argv: ARGV,
      env: {},
      cwd: '/work/repo',
      isRepo: async () => true,
      readRecents: async () => [
        '/recent',
      ],
    });
    expect(result).toBe('/work/repo');
  });
});
