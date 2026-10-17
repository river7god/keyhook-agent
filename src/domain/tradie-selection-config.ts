import { z } from 'zod';

/**
 * Per-organization tradie selection policy (decisions.md 2026-10-17).
 * Hard eligibility rules (active, trade, suburb, emergency call-outs) are always enforced in code;
 * this config only controls how eligible tradies are ranked and who picks among them.
 */
export const RANKING_FACTORS = ['rating', 'availability', 'familiarity', 'workload'] as const;
export type RankingFactor = (typeof RANKING_FACTORS)[number];

export const tradieSelectionConfigSchema = z.object({
  /** rules: highest score wins. llm: the model picks from the ranked shortlist and gives a reason. */
  strategy: z.enum(['rules', 'llm']),
  /** Relative weights; 0 disables a factor. */
  weights: z.object({
    rating: z.number().min(0).max(10),
    availability: z.number().min(0).max(10),
    familiarity: z.number().min(0).max(10),
    workload: z.number().min(0).max(10),
  }),
  /** How far ahead free slots count toward the availability factor. */
  availabilityHorizonHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30),
  /** Number of top-ranked candidates offered to the LLM strategy. */
  shortlistSize: z.number().int().min(1).max(10),
});

export type TradieSelectionConfig = z.infer<typeof tradieSelectionConfigSchema>;

export const DEFAULT_TRADIE_SELECTION: TradieSelectionConfig = {
  strategy: 'rules',
  weights: { rating: 1, availability: 1, familiarity: 0.5, workload: 0.5 },
  availabilityHorizonHours: 24 * 7,
  shortlistSize: 3,
};
