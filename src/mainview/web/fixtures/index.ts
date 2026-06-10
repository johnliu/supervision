// Fixture registry. Scenario shapes are documented in
// docs/specs/diff-navigation.md, Appendix B — keep them in sync.

import { basic } from './basic';
import { edgeBlocks } from './edgeBlocks';
import { gapsLarge, gapsSmall } from './gaps';
import { longFile, pureAddDelete, stagedBoth } from './misc';
import type { FixtureData } from './types';

export type { FixtureData } from './types';

const registry: Record<string, () => FixtureData> = {
  basic,
  'gaps-small': gapsSmall,
  'gaps-large': gapsLarge,
  'edge-blocks': edgeBlocks,
  'pure-add-delete': pureAddDelete,
  'long-file': longFile,
  'staged-both': stagedBoth,
};

export function fixtureIds(): string[] {
  return Object.keys(registry);
}

export function getFixture(id: string): FixtureData {
  const make = registry[id];
  if (!make) {
    console.warn(`Unknown fixture "${id}", falling back to "basic"`);
    return registry.basic();
  }
  return make();
}
