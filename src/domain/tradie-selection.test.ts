import { describe, expect, it } from 'vitest';
import { rankCandidates, type CandidateFacts } from './tradie-selection';
import { DEFAULT_TRADIE_SELECTION, type TradieSelectionConfig } from './tradie-selection-config';

const now = new Date('2026-10-19T00:00:00Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

const base: CandidateFacts = {
  tradieId: 'a',
  businessName: 'A',
  rating: 4,
  earliestFreeSlot: inHours(24),
  pastJobsAtProperty: 0,
  openJobs: 0,
};

const only = (factor: keyof TradieSelectionConfig['weights']): TradieSelectionConfig => ({
  ...DEFAULT_TRADIE_SELECTION,
  weights: { rating: 0, availability: 0, familiarity: 0, workload: 0, [factor]: 1 },
});

describe('rankCandidates', () => {
  it('ranks by rating when only rating is weighted', () => {
    const ranked = rankCandidates(
      [
        { ...base, tradieId: 'low', rating: 3.9 },
        { ...base, tradieId: 'high', rating: 4.8 },
      ],
      only('rating'),
      now,
    );
    expect(ranked.map((r) => r.tradieId)).toEqual(['high', 'low']);
  });

  it('prefers the earliest free slot when availability is weighted', () => {
    const ranked = rankCandidates(
      [
        { ...base, tradieId: 'later', earliestFreeSlot: inHours(100) },
        { ...base, tradieId: 'soon', earliestFreeSlot: inHours(2) },
        { ...base, tradieId: 'none', earliestFreeSlot: null },
      ],
      only('availability'),
      now,
    );
    expect(ranked.map((r) => r.tradieId)).toEqual(['soon', 'later', 'none']);
  });

  it('rewards familiarity with the property and penalises workload', () => {
    expect(
      rankCandidates(
        [base, { ...base, tradieId: 'b', pastJobsAtProperty: 2 }],
        only('familiarity'),
        now,
      )[0]?.tradieId,
    ).toBe('b');
    expect(
      rankCandidates(
        [
          { ...base, openJobs: 4 },
          { ...base, tradieId: 'b' },
        ],
        only('workload'),
        now,
      )[0]?.tradieId,
    ).toBe('b');
  });

  it('breaks ties deterministically by id', () => {
    const ranked = rankCandidates(
      [
        { ...base, tradieId: 'z' },
        { ...base, tradieId: 'm' },
      ],
      DEFAULT_TRADIE_SELECTION,
      now,
    );
    expect(ranked.map((r) => r.tradieId)).toEqual(['m', 'z']);
  });

  it('keeps scores within 0..1', () => {
    for (const r of rankCandidates([base], DEFAULT_TRADIE_SELECTION, now)) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
