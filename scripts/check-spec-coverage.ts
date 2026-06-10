// Spec-to-test traceability check: every normative spec ID must appear in at
// least one test title (unit or e2e), unless its row is withdrawn
// (~~struck~~) or marked structural/manual. Run: bun scripts/check-spec-coverage.ts

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

function collectFiles(dir: string, suffixes: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, {
    withFileTypes: true,
  })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
        continue;
      }
      out.push(...collectFiles(full, suffixes));
    } else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      out.push(full);
    }
  }
  return out;
}

interface SpecItem {
  id: string;
  coveredBy: string;
  withdrawn: boolean;
}

function parseSpecItems(): SpecItem[] {
  const items: SpecItem[] = [];
  for (const file of collectFiles(path.join(root, 'docs/specs'), [
    '.md',
  ])) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      // STR-* rows are structural invariants (review-enforced, no Covered-by
      // column) — out of scope for automated traceability.
      const match = /^\| ((?:STOP|EXP|NAV|CUR|SEL|SCR|FILE)-\d+) \|(.*)\|([^|]*)\|$/.exec(line);
      if (!match) {
        continue;
      }
      items.push({
        id: match[1] as string,
        coveredBy: (match[3] as string).trim(),
        withdrawn: (match[2] as string).includes('~~'),
      });
    }
  }
  return items;
}

const testSources = [
  ...collectFiles(path.join(root, 'src'), [
    '.test.ts',
  ]),
  ...collectFiles(path.join(root, 'tests'), [
    '.e2e.ts',
  ]),
]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const failures: string[] = [];
for (const item of parseSpecItems()) {
  if (item.withdrawn) {
    continue;
  }
  if (/^(structural|manual)/.test(item.coveredBy)) {
    continue;
  }
  if (item.coveredBy.startsWith('planned')) {
    failures.push(`${item.id}: still marked "${item.coveredBy}"`);
    continue;
  }
  if (!testSources.includes(item.id)) {
    failures.push(`${item.id}: no test title mentions it (Covered by says "${item.coveredBy}")`);
  }
}

if (failures.length > 0) {
  console.error('Spec coverage check FAILED:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}
console.log('Spec coverage check passed: every active spec item is referenced by a test.');
