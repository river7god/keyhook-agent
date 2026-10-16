import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { jobs, properties } from '@/db/schema';

export async function listJobs(db: DbOrTx, organizationId: string, opts: { limit?: number } = {}) {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      state: jobs.state,
      urgency: jobs.urgency,
      trade: jobs.trade,
      source: jobs.source,
      estimateCents: jobs.estimateCents,
      createdAt: jobs.createdAt,
      address: properties.addressLine1,
      suburb: properties.suburb,
    })
    .from(jobs)
    .innerJoin(
      properties,
      and(eq(properties.organizationId, jobs.organizationId), eq(properties.id, jobs.propertyId)),
    )
    .where(eq(jobs.organizationId, organizationId))
    .orderBy(desc(jobs.createdAt))
    .limit(opts.limit ?? 50);
}
