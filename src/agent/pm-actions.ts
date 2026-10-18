import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  approvals,
  jobs,
  properties,
  propertyManagers,
  tradieAvailability,
  tradies,
  type Trade,
  type Urgency,
} from '@/db/schema';
import { writeAudit } from '@/domain/audit';
import { DomainError } from '@/domain/errors';
import { recordHandBackCorrections } from '@/domain/feedback';
import { getCase, transitionCase } from '@/domain/arrears';
import { getJob, transitionJob } from '@/domain/jobs';
import { queueOutbound } from '@/domain/messages';
import { formatNzd } from '@/lib/money';
import { approveSpendTool, approveVariationTool } from '@/tools/approval-tools';
import { sendArrearsNoticeTool } from '@/tools/arrears-tools';
import { executeTool } from '@/tools/execute';

/**
 * A PM's decision on a pending approval. This is the only path that can run `approve_spend`:
 * the approval record is written first (as the PM), then the approval-level tool is executed with
 * the PM as actor, and executeTool's gate verifies the stored record (rule 2).
 * Rejection escalates the job (confirmed business rule) so the PM decides what happens next.
 */
export async function recordApprovalDecision(
  db: DbOrTx,
  args: {
    organizationId: string;
    approvalId: string;
    decision: 'approved' | 'rejected';
    decidedBy: string;
    note: string | null;
    now: Date;
  },
): Promise<{ jobId: string | null; arrearsCaseId: string | null; state: string }> {
  return db.transaction(async (tx) => {
    const [approval] = await tx
      .update(approvals)
      .set({
        status: args.decision,
        decidedBy: args.decidedBy,
        decidedAt: args.now,
        decisionNote: args.note,
      })
      .where(
        and(
          eq(approvals.organizationId, args.organizationId),
          eq(approvals.id, args.approvalId),
          eq(approvals.status, 'pending'),
        ),
      )
      .returning();
    if (!approval)
      throw new DomainError('CONFLICT', 'Approval is not pending (already decided or not found)');

    const pm = { type: 'pm' as const, id: args.decidedBy };
    await writeAudit(tx, {
      organizationId: args.organizationId,
      jobId: approval.jobId,
      arrearsCaseId: approval.arrearsCaseId,
      actorType: 'pm',
      actorId: args.decidedBy,
      action: `approval.${args.decision}`,
      reason: args.note ?? `Spend ${args.decision}`,
      input: { approvalId: approval.id, amountCents: approval.amountCents },
      outcome: 'ok',
    });

    if (approval.arrearsCaseId) {
      return decideArrearsNotice(tx, {
        organizationId: args.organizationId,
        approvalId: approval.id,
        caseId: approval.arrearsCaseId,
        decision: args.decision,
        pm,
        note: args.note,
        now: args.now,
      });
    }
    if (!approval.jobId) throw new Error(`Approval ${approval.id} has no subject`);
    const job = await getJob(tx, args.organizationId, approval.jobId);
    if (args.decision === 'approved') {
      const r = await executeTool(
        approval.kind === 'variation' ? approveVariationTool : approveSpendTool,
        {
          db: tx,
          organizationId: args.organizationId,
          jobId: job.id,
          actor: pm,
          reason: `PM approved ${formatNzd(approval.amountCents)}`,
          idempotencyScope: `${job.id}:approval:${approval.id}`,
          now: args.now,
        },
        { approvalId: approval.id },
      );
      if (!r.ok) throw new DomainError('CONFLICT', r.error.message, { code: r.error.code });
    } else {
      if (approval.kind === 'variation' && job.assignedTradieId) {
        await queueOutbound(tx, {
          organizationId: args.organizationId,
          jobId: job.id,
          recipientType: 'tradie',
          recipientId: job.assignedTradieId,
          body: "The extra cost wasn't approved — please don't go ahead with the additional work. The property manager will be in touch.",
          idempotencyKey: `${job.id}:approval:${approval.id}:rejected:tradie`,
        });
      }
      await transitionJob(tx, {
        organizationId: args.organizationId,
        jobId: job.id,
        to: 'ESCALATED',
        actor: pm,
        reason:
          `PM rejected ${approval.kind === 'variation' ? 'variation to' : ''} ${formatNzd(approval.amountCents)}${args.note ? `: ${args.note}` : ''}`.replace(
            /\s+/g,
            ' ',
          ),
      });
    }
    const after = await getJob(tx, args.organizationId, job.id);
    return { jobId: after.id, arrearsCaseId: null, state: after.state };
  });
}

/**
 * Arrears notice decision: approval sends the templated 14-day notice through the approval-level
 * tool; rejection hands the case to the PM. If the case moved on while the notice waited (a
 * promise, or paid up), the notice is not sent and the reason is audited.
 */
async function decideArrearsNotice(
  tx: DbOrTx,
  args: {
    organizationId: string;
    approvalId: string;
    caseId: string;
    decision: 'approved' | 'rejected';
    pm: { type: 'pm'; id: string };
    note: string | null;
    now: Date;
  },
): Promise<{ jobId: null; arrearsCaseId: string; state: string }> {
  const c = await getCase(tx, args.organizationId, args.caseId);
  const done = (state: string) => ({ jobId: null, arrearsCaseId: c.id, state });
  if (c.state !== 'NOTICE_PENDING') {
    await writeAudit(tx, {
      organizationId: args.organizationId,
      arrearsCaseId: c.id,
      actorType: 'pm',
      actorId: args.pm.id,
      action: 'arrears.notice_superseded',
      reason: `Case is ${c.state}; notice not sent`,
      input: { approvalId: args.approvalId, decision: args.decision },
      outcome: 'ok',
    });
    return done(c.state);
  }
  if (args.decision === 'approved') {
    const r = await executeTool(
      sendArrearsNoticeTool,
      {
        db: tx,
        organizationId: args.organizationId,
        jobId: null,
        arrearsCaseId: c.id,
        actor: args.pm,
        reason: 'PM approved the 14-day notice to remedy',
        idempotencyScope: `arrears:${c.id}:approval:${args.approvalId}`,
        now: args.now,
      },
      { approvalId: args.approvalId },
    );
    if (!r.ok) throw new DomainError('CONFLICT', r.error.message, { code: r.error.code });
  } else {
    await transitionCase(tx, {
      organizationId: args.organizationId,
      caseId: c.id,
      to: 'ESCALATED',
      actor: args.pm,
      reason: `PM rejected the notice${args.note ? `: ${args.note}` : ''}`,
      patch: { escalationReason: 'PM rejected the 14-day notice; PM handling' },
      now: args.now,
    });
  }
  return done((await getCase(tx, args.organizationId, c.id)).state);
}

export async function listPendingApprovals(db: DbOrTx, organizationId: string) {
  return db
    .select({
      id: approvals.id,
      jobId: approvals.jobId,
      kind: approvals.kind,
      previousAmountCents: approvals.previousAmountCents,
      amountCents: approvals.amountCents,
      reason: approvals.reason,
      createdAt: approvals.createdAt,
      jobTitle: jobs.title,
      address: properties.addressLine1,
      suburb: properties.suburb,
      tradie: tradies.businessName,
    })
    .from(approvals)
    .innerJoin(
      jobs,
      and(eq(jobs.organizationId, approvals.organizationId), eq(jobs.id, approvals.jobId)),
    )
    .innerJoin(
      properties,
      and(eq(properties.organizationId, jobs.organizationId), eq(properties.id, jobs.propertyId)),
    )
    .leftJoin(
      tradies,
      and(eq(tradies.organizationId, jobs.organizationId), eq(tradies.id, jobs.assignedTradieId)),
    )
    .where(and(eq(approvals.organizationId, organizationId), eq(approvals.status, 'pending')))
    .orderBy(desc(approvals.createdAt));
}

type Pm = { id: string; email: string };

async function requirePm(db: DbOrTx, organizationId: string, pmId: string): Promise<Pm> {
  const [pm] = await db
    .select({ id: propertyManagers.id, email: propertyManagers.email })
    .from(propertyManagers)
    .where(
      and(
        eq(propertyManagers.organizationId, organizationId),
        eq(propertyManagers.id, pmId),
        eq(propertyManagers.active, true),
      ),
    );
  if (!pm) throw new DomainError('VALIDATION', 'Unknown property manager');
  return pm;
}

/**
 * PM hands an escalated job back to the agent (decisions.md: "Hand-back semantics"). The job
 * returns to the state it was escalated from. The PM may correct urgency/trade; their review
 * covers the original triage flags, so a job escalated at triage is not re-triaged.
 */
export async function handBackJob(
  db: DbOrTx,
  args: {
    organizationId: string;
    jobId: string;
    propertyManagerId: string;
    note: string | null;
    urgency?: Urgency | null;
    trade?: Trade | null;
    now: Date;
  },
) {
  return db.transaction(async (tx) => {
    const pm = await requirePm(tx, args.organizationId, args.propertyManagerId);
    const job = await getJob(tx, args.organizationId, args.jobId);
    if (job.state !== 'ESCALATED' || !job.stateBeforeEscalation) {
      throw new DomainError('INVALID_TRANSITION', 'Only escalated jobs can be handed back');
    }
    await recordHandBackCorrections(tx, {
      job,
      propertyManagerId: pm.id,
      urgency: args.urgency ?? null,
      trade: args.trade ?? null,
      note: args.note,
    });
    const after = await transitionJob(tx, {
      organizationId: args.organizationId,
      jobId: args.jobId,
      to: job.stateBeforeEscalation,
      actor: { type: 'pm', id: pm.email },
      reason: `Handed back by PM${args.note ? `: ${args.note}` : ''}`,
      patch: {
        pmReviewedAt: args.now,
        ...(args.urgency ? { urgency: args.urgency } : {}),
        ...(args.trade ? { trade: args.trade } : {}),
      },
    });
    return { jobId: after.id, state: after.state };
  });
}

/** PM-only cancellation (spec §5). Frees any booked tradie slot. */
export async function cancelJob(
  db: DbOrTx,
  args: { organizationId: string; jobId: string; propertyManagerId: string; reason: string },
) {
  return db.transaction(async (tx) => {
    const pm = await requirePm(tx, args.organizationId, args.propertyManagerId);
    const after = await transitionJob(tx, {
      organizationId: args.organizationId,
      jobId: args.jobId,
      to: 'CANCELLED',
      actor: { type: 'pm', id: pm.email },
      reason: args.reason,
    });
    await tx
      .update(tradieAvailability)
      .set({ bookedJobId: null })
      .where(
        and(
          eq(tradieAvailability.organizationId, args.organizationId),
          eq(tradieAvailability.bookedJobId, args.jobId),
        ),
      );
    return { jobId: after.id, state: after.state };
  });
}

/** PM writes to the tenant or assigned tradie from the dashboard. Audited as the PM. */
export async function pmSendMessage(
  db: DbOrTx,
  args: {
    organizationId: string;
    jobId: string;
    propertyManagerId: string;
    recipient: 'tenant' | 'tradie';
    body: string;
    clientRequestId: string;
  },
) {
  const result = await db.transaction(async (tx) => {
    const pm = await requirePm(tx, args.organizationId, args.propertyManagerId);
    const job = await getJob(tx, args.organizationId, args.jobId);
    const recipientId = args.recipient === 'tenant' ? job.reportedByTenantId : job.assignedTradieId;
    if (!recipientId) throw new DomainError('VALIDATION', `This job has no ${args.recipient}`);
    const msg = await queueOutbound(tx, {
      organizationId: args.organizationId,
      jobId: job.id,
      recipientType: args.recipient,
      recipientId,
      body: args.body,
      idempotencyKey: `pm:${pm.id}:${args.clientRequestId}`,
      sender: { type: 'pm', id: pm.id },
    });
    await writeAudit(tx, {
      organizationId: args.organizationId,
      jobId: job.id,
      actorType: 'pm',
      actorId: pm.email,
      action: 'send_message',
      reason: 'PM message from dashboard',
      input: { recipient: args.recipient, body: args.body },
      output: { messageId: msg.id },
      outcome: 'ok',
      idempotencyKey: `pm:${pm.id}:${args.clientRequestId}`,
    });
    return { messageId: msg.id };
  });
  // Delivery happens after the caller's transaction commits (see the messages route).
  return result;
}
