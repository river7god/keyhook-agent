import { and, asc, eq, lte } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  followUps,
  organizations,
  properties,
  type ActorType,
  type FollowUpKind,
} from '@/db/schema';
import { outsideQuietHours } from '@/lib/time';
import type { JobState } from '@/workflows/job-states';
import { DomainError } from './errors';
import type { Job } from './jobs';
import {
  DEFAULT_WORKFLOW_POLICY,
  workflowPolicySchema,
  type WorkflowPolicy,
} from './workflow-policy-config';

export type FollowUp = typeof followUps.$inferSelect;

/** The job states in which each follow-up kind is still meaningful. */
export const FOLLOW_UP_STATES: Record<FollowUpKind, readonly JobState[]> = {
  info_chase: ['NEEDS_INFO'],
  quote_chase: ['AWAITING_QUOTE'],
  approval_chase: ['AWAITING_APPROVAL'],
  slot_chase: ['SCHEDULING'],
  visit_check: ['SCHEDULED', 'IN_PROGRESS'],
  confirmation_chase: ['AWAITING_CONFIRMATION'],
};

const WAIT_FOR_STATE: Partial<Record<JobState, FollowUpKind>> = {
  NEEDS_INFO: 'info_chase',
  AWAITING_QUOTE: 'quote_chase',
  AWAITING_APPROVAL: 'approval_chase',
  SCHEDULING: 'slot_chase',
  SCHEDULED: 'visit_check',
  IN_PROGRESS: 'visit_check',
  AWAITING_CONFIRMATION: 'confirmation_chase',
};

export async function loadWorkflowPolicy(
  db: DbOrTx,
  organizationId: string,
): Promise<WorkflowPolicy> {
  const [org] = await db
    .select({ workflowPolicy: organizations.workflowPolicy })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) throw new DomainError('NOT_FOUND', 'Organization not found', { organizationId });
  const parsed = workflowPolicySchema.safeParse(org.workflowPolicy);
  return parsed.success ? parsed.data : DEFAULT_WORKFLOW_POLICY;
}

/** Cancel the pending follow-up for a job (the awaited thing happened, or the wait changed). */
export async function satisfyFollowUps(
  db: DbOrTx,
  organizationId: string,
  jobId: string,
): Promise<void> {
  await db
    .update(followUps)
    .set({ status: 'satisfied' })
    .where(
      and(
        eq(followUps.organizationId, organizationId),
        eq(followUps.jobId, jobId),
        eq(followUps.status, 'scheduled'),
      ),
    );
}

/** Who a wait is waiting on, and how long the first nudge waits. */
function firstWait(job: Job, kind: FollowUpKind, policy: WorkflowPolicy, now: Date) {
  const h = (n: number) => new Date(now.getTime() + n * 3_600_000);
  switch (kind) {
    case 'info_chase':
      return {
        targetType: 'tenant' as const,
        targetId: job.reportedByTenantId,
        dueAt: h(policy.clarify.reminderAfterHours),
      };
    case 'slot_chase':
      return {
        targetType: 'tenant' as const,
        targetId: job.reportedByTenantId,
        dueAt: h(policy.slot.reminderAfterHours),
      };
    case 'confirmation_chase':
      return {
        targetType: 'tenant' as const,
        targetId: job.reportedByTenantId,
        dueAt: h(policy.confirmation.reminderAfterHours),
      };
    case 'quote_chase':
      return {
        targetType: 'tradie' as const,
        targetId: job.assignedTradieId,
        dueAt: h(policy.quote.reminderAfterHours[job.urgency ?? 'routine']),
      };
    case 'visit_check': {
      const base = job.scheduledEnd && job.scheduledEnd > now ? job.scheduledEnd : now;
      return {
        targetType: 'tradie' as const,
        targetId: job.assignedTradieId,
        dueAt: new Date(base.getTime() + policy.visit.checkAfterEndHours * 3_600_000),
      };
    }
    case 'approval_chase':
      return {
        targetType: 'pm' as const,
        targetId: null,
        dueAt: h(policy.approval.reminderAfterHours),
      };
  }
}

/**
 * Schedule the next follow-up for a job's current wait (replacing any pending one).
 * `attempt` 1 is the first nudge; handlers schedule later attempts explicitly.
 */
export async function scheduleFollowUp(
  db: DbOrTx,
  args: {
    job: Job;
    kind: FollowUpKind;
    attempt: number;
    dueAt: Date;
    targetType: ActorType;
    targetId: string;
    policy: WorkflowPolicy;
  },
): Promise<FollowUp> {
  await satisfyFollowUps(db, args.job.organizationId, args.job.id);
  const [row] = await db
    .insert(followUps)
    .values({
      organizationId: args.job.organizationId,
      jobId: args.job.id,
      kind: args.kind,
      attempt: args.attempt,
      targetType: args.targetType,
      targetId: args.targetId,
      dueAt: outsideQuietHours(args.dueAt, args.policy.quietHours),
    })
    .returning();
  if (!row) throw new Error('follow-up insert failed');
  return row;
}

/**
 * Make sure a job that is waiting on someone has exactly one pending follow-up.
 * No-op for states nobody waits on (RECEIVED, TRIAGED, ESCALATED, terminal) or if one exists.
 */
export async function ensureFollowUp(db: DbOrTx, job: Job, now: Date): Promise<FollowUp | null> {
  const kind = WAIT_FOR_STATE[job.state];
  if (!kind) return null;
  const [existing] = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.jobId, job.id), eq(followUps.status, 'scheduled')));
  if (existing) return existing;

  const policy = await loadWorkflowPolicy(db, job.organizationId);
  const wait = firstWait(job, kind, policy, now);
  let targetId = wait.targetId;
  if (wait.targetType === 'pm') {
    const [p] = await db
      .select({ pm: properties.propertyManagerId })
      .from(properties)
      .where(
        and(eq(properties.organizationId, job.organizationId), eq(properties.id, job.propertyId)),
      );
    targetId = p?.pm ?? null;
  }
  if (!targetId) return null; // e.g. PM-created job with no tenant to chase
  return scheduleFollowUp(db, {
    job,
    kind,
    attempt: 1,
    dueAt: wait.dueAt,
    targetType: wait.targetType,
    targetId,
    policy,
  });
}

export async function listDueFollowUps(db: DbOrTx, now: Date, limit = 50) {
  return db
    .select()
    .from(followUps)
    .where(and(eq(followUps.status, 'scheduled'), lte(followUps.dueAt, now)))
    .orderBy(asc(followUps.dueAt))
    .limit(limit);
}
