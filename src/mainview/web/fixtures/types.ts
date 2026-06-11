import type { Comment, ReviewModel, SupervisionConfig } from '../../../shared/types';

/** Everything a fixture scenario seeds the in-memory backend with. Config keys
 * a fixture doesn't care about fall back to CONFIG_DEFAULTS in the backend. */
export interface FixtureData {
  id: string;
  model: ReviewModel;
  comments: Comment[];
  config: Partial<SupervisionConfig>;
}
