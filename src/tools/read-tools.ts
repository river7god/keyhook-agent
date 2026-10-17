import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { jobs, properties } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { getJob } from '@/domain/jobs';
import {
  findEligibleTradies,
  loadSelectionConfig,
  rankCandidates,
} from '@/domain/tradie-selection';
import { formatNzDateTime } from '@/lib/time';
import { defineTool } from './types';

export const getPropertyTool = defineTool({
  name: 'get_property',
  description:
    'Get the address, suburb and PM-entered access notes of the property this job is for.',
  permission: 'read',
  input: z.strictObject({}),
  async run(ctx) {
    const job = await getJob(ctx.db, ctx.organizationId, ctx.jobId);
    const [p] = await ctx.db
      .select({
        address: properties.addressLine1,
        suburb: properties.suburb,
        city: properties.city,
        accessNotes: properties.accessNotes,
      })
      .from(properties)
      .where(
        and(eq(properties.organizationId, ctx.organizationId), eq(properties.id, job.propertyId)),
      );
    if (!p) throw new DomainError('NOT_FOUND', 'Property not found');
    return p;
  },
});

export const listJobsForPropertyTool = defineTool({
  name: 'list_jobs_for_property',
  description:
    'List previous maintenance jobs at this property (newest first): title, state, trade, dates. Use to spot repeat issues.',
  permission: 'read',
  input: z.strictObject({ limit: z.number().int().min(1).max(20) }),
  async run(ctx, input) {
    const job = await getJob(ctx.db, ctx.organizationId, ctx.jobId);
    const rows = await ctx.db
      .select({
        title: jobs.title,
        state: jobs.state,
        trade: jobs.trade,
        createdAt: jobs.createdAt,
        closedAt: jobs.closedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.organizationId, ctx.organizationId), eq(jobs.propertyId, job.propertyId)))
      .orderBy(desc(jobs.createdAt))
      .limit(input.limit + 1);
    return rows
      .filter((r) => r.createdAt.getTime() !== job.createdAt.getTime())
      .slice(0, input.limit)
      .map((r) => ({
        ...r,
        createdAt: formatNzDateTime(r.createdAt),
        closedAt: r.closedAt ? formatNzDateTime(r.closedAt) : null,
      }));
  },
});

/**
 * Ranked eligible tradies for this job. Eligibility is hard-coded policy; ranking follows the
 * organization's tradie selection config. `selectable` tells the model which ids request_quote
 * will accept under the current strategy.
 */
export const searchTradiesTool = defineTool({
  name: 'search_tradies',
  description:
    "Find eligible tradies for this job's trade and suburb, ranked by the organization's policy. Returns which tradie ids you are allowed to request a quote from.",
  permission: 'read',
  input: z.strictObject({}),
  async run(ctx) {
    return rankedTradiesForJob(ctx.db, ctx.organizationId, ctx.jobId, ctx.now);
  },
});

export async function rankedTradiesForJob(
  db: Parameters<typeof getJob>[0],
  organizationId: string,
  jobId: string,
  now: Date,
) {
  const job = await getJob(db, organizationId, jobId);
  if (!job.trade || !job.urgency) throw new DomainError('VALIDATION', 'Job is not triaged yet');
  const [property] = await db
    .select({ suburb: properties.suburb })
    .from(properties)
    .where(and(eq(properties.organizationId, organizationId), eq(properties.id, job.propertyId)));
  if (!property) throw new DomainError('NOT_FOUND', 'Property not found');

  const config = await loadSelectionConfig(db, organizationId);
  const candidates = await findEligibleTradies(db, {
    organizationId,
    trade: job.trade,
    suburb: property.suburb,
    urgency: job.urgency,
    propertyId: job.propertyId,
    now,
    horizonHours: config.availabilityHorizonHours,
  });
  const ranked = rankCandidates(candidates, config, now);
  const selectable =
    config.strategy === 'rules'
      ? ranked.slice(0, 1).map((r) => r.tradieId)
      : ranked.slice(0, config.shortlistSize).map((r) => r.tradieId);

  return {
    strategy: config.strategy,
    selectableTradieIds: selectable,
    candidates: ranked.map((r) => ({
      tradieId: r.tradieId,
      businessName: r.businessName,
      rating: r.rating,
      earliestFreeSlot: r.earliestFreeSlot ? formatNzDateTime(r.earliestFreeSlot) : null,
      pastJobsAtProperty: r.pastJobsAtProperty,
      openJobs: r.openJobs,
      score: Math.round(r.score * 100) / 100,
    })),
  };
}
