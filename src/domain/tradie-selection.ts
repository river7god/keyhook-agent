import {
  and,
  arrayContains,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  jobs,
  organizations,
  tradieAvailability,
  tradies,
  type Trade,
  type Urgency,
} from '@/db/schema';
import { TERMINAL_STATES } from '@/workflows/job-states';
import { DomainError } from './errors';
import {
  DEFAULT_TRADIE_SELECTION,
  RANKING_FACTORS,
  tradieSelectionConfigSchema,
  type RankingFactor,
  type TradieSelectionConfig,
} from './tradie-selection-config';

export interface CandidateFacts {
  tradieId: string;
  businessName: string;
  rating: number | null;
  /** Earliest unbooked slot start within the horizon, or null. */
  earliestFreeSlot: Date | null;
  /** Completed jobs this tradie has done at the property. */
  pastJobsAtProperty: number;
  /** Non-terminal jobs currently assigned. */
  openJobs: number;
}

export interface RankedCandidate extends CandidateFacts {
  score: number;
  factorScores: Record<RankingFactor, number>;
}

const WORKLOAD_SATURATION = 5;

/** Pure scoring: each factor normalised to 0..1, combined by weight. Deterministic tie-break. */
export function rankCandidates(
  candidates: CandidateFacts[],
  config: TradieSelectionConfig,
  now: Date,
): RankedCandidate[] {
  const horizonMs = config.availabilityHorizonHours * 3_600_000;
  const totalWeight = RANKING_FACTORS.reduce((sum, f) => sum + config.weights[f], 0) || 1;

  return candidates
    .map((c) => {
      const untilFree = c.earliestFreeSlot ? c.earliestFreeSlot.getTime() - now.getTime() : null;
      const factorScores: Record<RankingFactor, number> = {
        rating: c.rating === null ? 0.5 : c.rating / 5,
        availability: untilFree === null ? 0 : Math.max(0, 1 - Math.max(0, untilFree) / horizonMs),
        familiarity: c.pastJobsAtProperty > 0 ? 1 : 0,
        workload: 1 - Math.min(c.openJobs, WORKLOAD_SATURATION) / WORKLOAD_SATURATION,
      };
      const score =
        RANKING_FACTORS.reduce((sum, f) => sum + config.weights[f] * factorScores[f], 0) /
        totalWeight;
      return { ...c, score, factorScores };
    })
    .sort((a, b) => b.score - a.score || a.tradieId.localeCompare(b.tradieId));
}

export async function loadSelectionConfig(
  db: DbOrTx,
  organizationId: string,
): Promise<TradieSelectionConfig> {
  const [org] = await db
    .select({ tradieSelection: organizations.tradieSelection })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) throw new DomainError('NOT_FOUND', 'Organization not found', { organizationId });
  const parsed = tradieSelectionConfigSchema.safeParse(org.tradieSelection);
  return parsed.success ? parsed.data : DEFAULT_TRADIE_SELECTION;
}

/**
 * Hard eligibility (always code-enforced): active, does the trade, covers the suburb, and offers
 * emergency call-outs when the job is an emergency. Returns facts for ranking.
 */
export async function findEligibleTradies(
  db: DbOrTx,
  args: {
    organizationId: string;
    trade: Trade;
    suburb: string;
    urgency: Urgency;
    propertyId: string;
    now: Date;
    horizonHours: number;
    excludeTradieIds?: string[];
  },
): Promise<CandidateFacts[]> {
  const conditions = [
    eq(tradies.organizationId, args.organizationId),
    eq(tradies.active, true),
    arrayContains(tradies.trades, [args.trade]),
    arrayContains(tradies.suburbs, [args.suburb]),
  ];
  if (args.urgency === 'emergency') conditions.push(eq(tradies.emergencyCallouts, true));
  if (args.excludeTradieIds?.length) conditions.push(notInArray(tradies.id, args.excludeTradieIds));

  const rows = await db
    .select({ id: tradies.id, businessName: tradies.businessName, rating: tradies.rating })
    .from(tradies)
    .where(and(...conditions));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const horizonEnd = new Date(args.now.getTime() + args.horizonHours * 3_600_000);

  const [slots, past, open] = await Promise.all([
    db
      .select({
        tradieId: tradieAvailability.tradieId,
        earliest: sql<Date>`min(${tradieAvailability.startsAt})`.mapWith(
          (v: string) => new Date(v),
        ),
      })
      .from(tradieAvailability)
      .where(
        and(
          eq(tradieAvailability.organizationId, args.organizationId),
          inArray(tradieAvailability.tradieId, ids),
          isNull(tradieAvailability.bookedJobId),
          gt(tradieAvailability.startsAt, args.now),
          lt(tradieAvailability.startsAt, horizonEnd),
        ),
      )
      .groupBy(tradieAvailability.tradieId),
    db
      .select({ tradieId: jobs.assignedTradieId, n: count() })
      .from(jobs)
      .where(
        and(
          eq(jobs.organizationId, args.organizationId),
          eq(jobs.propertyId, args.propertyId),
          eq(jobs.state, 'CLOSED'),
          inArray(jobs.assignedTradieId, ids),
        ),
      )
      .groupBy(jobs.assignedTradieId),
    db
      .select({ tradieId: jobs.assignedTradieId, n: count() })
      .from(jobs)
      .where(
        and(
          eq(jobs.organizationId, args.organizationId),
          notInArray(jobs.state, [...TERMINAL_STATES]),
          inArray(jobs.assignedTradieId, ids),
        ),
      )
      .groupBy(jobs.assignedTradieId),
  ]);

  return rows.map((r) => ({
    tradieId: r.id,
    businessName: r.businessName,
    rating: r.rating,
    earliestFreeSlot: slots.find((s) => s.tradieId === r.id)?.earliest ?? null,
    pastJobsAtProperty: past.find((p) => p.tradieId === r.id)?.n ?? 0,
    openJobs: open.find((o) => o.tradieId === r.id)?.n ?? 0,
  }));
}

/** Unbooked future slots for a tradie, soonest first. */
export async function listFreeSlots(
  db: DbOrTx,
  args: { organizationId: string; tradieId: string; now: Date; limit: number },
) {
  return db
    .select({
      id: tradieAvailability.id,
      startsAt: tradieAvailability.startsAt,
      endsAt: tradieAvailability.endsAt,
    })
    .from(tradieAvailability)
    .where(
      and(
        eq(tradieAvailability.organizationId, args.organizationId),
        eq(tradieAvailability.tradieId, args.tradieId),
        isNull(tradieAvailability.bookedJobId),
        gt(tradieAvailability.startsAt, args.now),
      ),
    )
    .orderBy(asc(tradieAvailability.startsAt))
    .limit(args.limit);
}
