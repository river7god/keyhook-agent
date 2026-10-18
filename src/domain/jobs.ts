import { and, desc, eq, isNull, notInArray } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { jobs, properties, tenancies, tenancyTenants, type ActorType } from '@/db/schema';
import { TERMINAL_STATES, type JobState } from '@/workflows/job-states';
import { checkTransition } from '@/workflows/state-machine';
import { writeAudit } from './audit';
import { DomainError } from './errors';
import { satisfyFollowUps } from './follow-ups';

export type Job = typeof jobs.$inferSelect;
type JobPatch = Partial<
  Pick<
    Job,
    | 'title'
    | 'summary'
    | 'slotOfferCount'
    | 'clarifyRounds'
    | 'excludedTradieIds'
    | 'pmReviewedAt'
    | 'mediaRequest'
    | 'offeredSlotIds'
    | 'urgency'
    | 'trade'
    | 'triageConfidence'
    | 'estimateCents'
    | 'assignedTradieId'
    | 'scheduledStart'
    | 'scheduledEnd'
  >
>;

export async function getJob(db: DbOrTx, organizationId: string, jobId: string): Promise<Job> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, jobId)));
  if (!job) throw new DomainError('NOT_FOUND', 'Job not found', { jobId });
  return job;
}

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

/** Open (non-terminal) jobs for a tenant, newest first — what the simulator lets them reply to. */
export async function listOpenJobsForTenant(db: DbOrTx, organizationId: string, tenantId: string) {
  return db
    .select({ id: jobs.id, title: jobs.title, state: jobs.state, createdAt: jobs.createdAt })
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        eq(jobs.reportedByTenantId, tenantId),
        notInArray(jobs.state, [...TERMINAL_STATES]),
      ),
    )
    .orderBy(desc(jobs.createdAt));
}

/**
 * New job from a tenant's first message. The tenant's *current* tenancy decides the property.
 * The message body is untrusted and stored as-is; triage replaces the placeholder title.
 */
export async function createJobFromTenantMessage(
  tx: DbOrTx,
  args: { organizationId: string; tenantId: string; body: string },
): Promise<Job> {
  const [tenancy] = await tx
    .select({ tenancyId: tenancies.id, propertyId: tenancies.propertyId })
    .from(tenancyTenants)
    .innerJoin(
      tenancies,
      and(
        eq(tenancies.organizationId, tenancyTenants.organizationId),
        eq(tenancies.id, tenancyTenants.tenancyId),
      ),
    )
    .where(
      and(
        eq(tenancyTenants.organizationId, args.organizationId),
        eq(tenancyTenants.tenantId, args.tenantId),
        isNull(tenancies.endDate),
      ),
    )
    .orderBy(desc(tenancies.startDate))
    .limit(1);
  if (!tenancy) {
    throw new DomainError('NOT_FOUND', 'Tenant has no current tenancy', {
      tenantId: args.tenantId,
    });
  }

  const [job] = await tx
    .insert(jobs)
    .values({
      organizationId: args.organizationId,
      propertyId: tenancy.propertyId,
      tenancyId: tenancy.tenancyId,
      reportedByTenantId: args.tenantId,
      source: 'tenant_message',
      createdByActorType: 'tenant',
      createdByActorId: args.tenantId,
      title: 'New maintenance request',
      description: args.body,
    })
    .returning();
  if (!job) throw new Error('job insert failed');

  await writeAudit(tx, {
    organizationId: args.organizationId,
    jobId: job.id,
    actorType: 'tenant',
    actorId: args.tenantId,
    action: 'job.created',
    reason: 'Tenant reported a new issue',
    output: { jobId: job.id, propertyId: job.propertyId },
    outcome: 'ok',
  });
  return job;
}

/**
 * A job raised by the agency rather than a tenant: an inspection finding (spec §12 R4) or a
 * Portfolio Monitor finding a PM opened (R7). When the property is let, the current tenancy's
 * primary contact is linked as the job's tenant (stored in reported_by_tenant_id) so the usual
 * tenant steps — updates, visit times, confirmation — work; a vacant property has no tenant and
 * the agent hands access arrangements to the PM.
 */
export async function createAgencyJob(
  tx: DbOrTx,
  args: {
    organizationId: string;
    propertyId: string;
    source: 'inspection' | 'agent_detected';
    actor: { type: ActorType; id: string | null };
    title: string;
    description: string;
    reason: string;
  },
): Promise<Job> {
  const [property] = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(eq(properties.organizationId, args.organizationId), eq(properties.id, args.propertyId)),
    );
  if (!property) {
    throw new DomainError('NOT_FOUND', 'Property not found', { propertyId: args.propertyId });
  }
  const [contact] = await tx
    .select({ tenancyId: tenancies.id, tenantId: tenancyTenants.tenantId })
    .from(tenancies)
    .innerJoin(
      tenancyTenants,
      and(
        eq(tenancyTenants.organizationId, tenancies.organizationId),
        eq(tenancyTenants.tenancyId, tenancies.id),
        eq(tenancyTenants.isPrimaryContact, true),
      ),
    )
    .where(
      and(
        eq(tenancies.organizationId, args.organizationId),
        eq(tenancies.propertyId, args.propertyId),
        isNull(tenancies.endDate),
      ),
    )
    .orderBy(desc(tenancies.startDate))
    .limit(1);

  const [job] = await tx
    .insert(jobs)
    .values({
      organizationId: args.organizationId,
      propertyId: args.propertyId,
      tenancyId: contact?.tenancyId ?? null,
      reportedByTenantId: contact?.tenantId ?? null,
      source: args.source,
      createdByActorType: args.actor.type,
      createdByActorId: args.actor.id,
      title: args.title.slice(0, 120),
      description: args.description,
    })
    .returning();
  if (!job) throw new Error('job insert failed');

  await writeAudit(tx, {
    organizationId: args.organizationId,
    jobId: job.id,
    actorType: args.actor.type,
    actorId: args.actor.id,
    action: 'job.created',
    reason: args.reason,
    output: {
      jobId: job.id,
      propertyId: job.propertyId,
      source: job.source,
      tenantLinked: Boolean(contact),
    },
    outcome: 'ok',
  });
  return job;
}

/**
 * The only way a job changes state. Enforces the state machine (rule 1), uses optimistic locking
 * on `version`, maintains state_before_escalation, and writes the audit row (rule 4) — all in the
 * caller's transaction.
 */
export async function transitionJob(
  tx: DbOrTx,
  args: {
    organizationId: string;
    jobId: string;
    to: JobState;
    actor: { type: ActorType; id?: string | null };
    reason: string;
    expectedVersion?: number;
    patch?: JobPatch;
    traceId?: string | null;
  },
): Promise<Job> {
  const [current] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.organizationId, args.organizationId), eq(jobs.id, args.jobId)))
    .for('update');
  if (!current) throw new DomainError('NOT_FOUND', 'Job not found', { jobId: args.jobId });

  if (args.expectedVersion !== undefined && current.version !== args.expectedVersion) {
    throw new DomainError('CONFLICT', 'Job changed since it was read', {
      jobId: args.jobId,
      expectedVersion: args.expectedVersion,
      actualVersion: current.version,
    });
  }

  const check = checkTransition(current.state, args.to, {
    actor: args.actor.type,
    stateBeforeEscalation: current.stateBeforeEscalation,
  });
  if (!check.ok) {
    await writeAudit(tx, {
      organizationId: args.organizationId,
      jobId: args.jobId,
      actorType: args.actor.type,
      actorId: args.actor.id ?? null,
      action: 'job.transition',
      reason: args.reason,
      input: { from: current.state, to: args.to },
      output: { error: check.reason },
      outcome: 'rejected',
      traceId: args.traceId ?? null,
    });
    throw new DomainError('INVALID_TRANSITION', check.reason, {
      from: current.state,
      to: args.to,
    });
  }

  const [updated] = await tx
    .update(jobs)
    .set({
      ...args.patch,
      state: args.to,
      stateBeforeEscalation: args.to === 'ESCALATED' ? current.state : null,
      closedAt: args.to === 'CLOSED' ? new Date() : current.closedAt,
      version: current.version + 1,
    })
    .where(and(eq(jobs.id, current.id), eq(jobs.version, current.version)))
    .returning();
  if (!updated) throw new DomainError('CONFLICT', 'Concurrent update', { jobId: args.jobId });
  // Whatever we were waiting for in the old state is no longer relevant.
  await satisfyFollowUps(tx, args.organizationId, args.jobId);

  await writeAudit(tx, {
    organizationId: args.organizationId,
    jobId: args.jobId,
    actorType: args.actor.type,
    actorId: args.actor.id ?? null,
    action: 'job.transition',
    reason: args.reason,
    input: { from: current.state, to: args.to, patch: args.patch ?? null },
    output: { version: updated.version },
    outcome: 'ok',
    traceId: args.traceId ?? null,
  });
  return updated;
}

/** Update descriptive fields without changing state (e.g. recording a quote). Audited. */
export async function patchJob(
  tx: DbOrTx,
  args: {
    organizationId: string;
    jobId: string;
    actor: { type: ActorType; id?: string | null };
    reason: string;
    patch: JobPatch;
  },
): Promise<Job> {
  const current = await getJob(tx, args.organizationId, args.jobId);
  const [updated] = await tx
    .update(jobs)
    .set({ ...args.patch, version: current.version + 1 })
    .where(and(eq(jobs.id, current.id), eq(jobs.version, current.version)))
    .returning();
  if (!updated) throw new DomainError('CONFLICT', 'Concurrent update', { jobId: args.jobId });
  await writeAudit(tx, {
    organizationId: args.organizationId,
    jobId: args.jobId,
    actorType: args.actor.type,
    actorId: args.actor.id ?? null,
    action: 'job.patch',
    reason: args.reason,
    input: args.patch,
    outcome: 'ok',
  });
  return updated;
}

/** Open jobs assigned to a tradie — what the simulator lets them reply to. */
export async function listOpenJobsForTradie(db: DbOrTx, organizationId: string, tradieId: string) {
  return db
    .select({ id: jobs.id, title: jobs.title, state: jobs.state, createdAt: jobs.createdAt })
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        eq(jobs.assignedTradieId, tradieId),
        notInArray(jobs.state, [...TERMINAL_STATES]),
      ),
    )
    .orderBy(desc(jobs.createdAt));
}
