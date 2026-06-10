import type { Comment, ReviewModel, SupervisionConfig } from '../../../shared/types';

/** Everything a fixture scenario seeds the in-memory backend with. */
export interface FixtureData {
  id: string;
  model: ReviewModel;
  comments: Comment[];
  config: SupervisionConfig;
}
