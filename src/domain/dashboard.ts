import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditLog, followUps, jobs, properties, tradies, type Urgency } from '@/db/schema';
import { JOB_STATES, type JobState } from '@/workflows/job-states';

/** Dashboard buckets: what a PM must act on first, what the agent is running, what's done. */
export const BUCKETS = {
  needs_pm: ['ESCALATED', 'AWAITING_APPROVAL'],
  active: JOB_STATES.filter(
    (s) => !(['ESCALATED', 'AWAITING_APPROVAL', 'CLOSED', 'CANCELLED'] as JobState[]).includes(s),
  ),
  done: ['CLOSED', 'CANCELLED'],
} as const satisfies Record<string, readonly JobState[]>;
export type Bucket = keyof typeof BUCKETS;

export async function stateCounts(db: DbOrTx, organizationId: string) {
  const rows = await db
    .select({ state: jobs.state, n: count() })
    .from(jobs)
    .where(eq(jobs.organizationId, organizationId))
    .groupBy(jobs.state);
  const byState = Object.fromEntries(rows.map((r) => [r.state, r.n])) as Partial<
    Record<JobState, number>
  >;
  const sum = (states: readonly JobState[]) => states.reduce((n, s) => n + (byState[s] ?? 0), 0);
  return {
    byState,
    needs_pm: sum(BUCKETS.needs_pm),
    active: sum(BUCKETS.active),
    done: sum(BUCKETS.done),
  };
}

export async function listDashboardJobs(
  db: DbOrTx,
  organizationId: string,
  filter: { bucket: Bucket; urgency?: Urgency | null; limit?: number },
) {
  const where: SQL[] = [
    eq(jobs.organizationId, organizationId),
    inArray(jobs.state, [...BUCKETS[filter.bucket]]),
  ];
  if (filter.urgency) where.push(eq(jobs.urgency, filter.urgency));

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      state: jobs.state,
      urgency: jobs.urgency,
      trade: jobs.trade,
      source: jobs.source,
      estimateCents: jobs.estimateCents,
      scheduledStart: jobs.scheduledStart,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      address: properties.addressLine1,
      suburb: properties.suburb,
      tradie: tradies.businessName,
      nextFollowUpAt: followUps.dueAt,
      nextFollowUpKind: followUps.kind,
    })
    .from(jobs)
    .innerJoin(
      properties,
      and(eq(properties.organizationId, jobs.organizationId), eq(properties.id, jobs.propertyId)),
    )
    .leftJoin(
      tradies,
      and(eq(tradies.organizationId, jobs.organizationId), eq(tradies.id, jobs.assignedTradieId)),
    )
    .leftJoin(followUps, and(eq(followUps.jobId, jobs.id), eq(followUps.status, 'scheduled')))
    .where(and(...where))
    .orderBy(
      // Emergencies first, then oldest waiting first for the PM queue; newest first otherwise.
      sql`case ${jobs.urgency} when 'emergency' then 0 when 'urgent' then 1 else 2 end`,
      filter.bucket === 'needs_pm' ? jobs.updatedAt : desc(jobs.updatedAt),
    )
    .limit(filter.limit ?? 100);

  // Latest escalation reason/recommendation for escalated jobs.
  const escalatedIds = rows.filter((r) => r.state === 'ESCALATED').map((r) => r.id);
  const packages = escalatedIds.length
    ? await db
        .selectDistinctOn([auditLog.jobId], { jobId: auditLog.jobId, output: auditLog.output })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, organizationId),
            inArray(auditLog.jobId, escalatedIds),
            eq(auditLog.action, 'job.escalation_package'),
          ),
        )
        .orderBy(auditLog.jobId, desc(auditLog.id))
    : [];

  return rows.map((r) => {
    const pkg = packages.find((p) => p.jobId === r.id)?.output as
      { reason?: string; recommendation?: string } | undefined;
    return {
      ...r,
      escalationReason: pkg?.reason ?? null,
      recommendation: pkg?.recommendation ?? null,
    };
  });
}

/** Org-wide audit log, newest first, optionally filtered by action prefix or actor type. */
export async function listAudit(
  db: DbOrTx,
  organizationId: string,
  filter: {
    actionPrefix?: string | null;
    actorType?: string | null;
    limit?: number;
    beforeId?: number | null;
  },
) {
  const where: SQL[] = [eq(auditLog.organizationId, organizationId)];
  if (filter.actionPrefix) where.push(sql`${auditLog.action} like ${`${filter.actionPrefix}%`}`);
  if (filter.actorType) where.push(sql`${auditLog.actorType}::text = ${filter.actorType}`);
  if (filter.beforeId) where.push(sql`${auditLog.id} < ${filter.beforeId}`);
  return db
    .select({
      id: auditLog.id,
      jobId: auditLog.jobId,
      jobTitle: jobs.title,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      action: auditLog.action,
      reason: auditLog.reason,
      outcome: auditLog.outcome,
      input: auditLog.input,
      output: auditLog.output,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(
      jobs,
      and(eq(jobs.organizationId, auditLog.organizationId), eq(jobs.id, auditLog.jobId)),
    )
    .where(and(...where))
    .orderBy(desc(auditLog.id))
    .limit(filter.limit ?? 100);
}
