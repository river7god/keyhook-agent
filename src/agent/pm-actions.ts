import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { approvals, jobs, properties, tradies } from '@/db/schema';
import { writeAudit } from '@/domain/audit';
import { DomainError } from '@/domain/errors';
import { getJob, transitionJob } from '@/domain/jobs';
import { formatNzd } from '@/lib/money';
import { approveSpendTool } from '@/tools/approval-tools';
import { executeTool } from '@/tools/execute';

/**
 * A PM's decision on a pending approval. This is the only path that can run `approve_spend`:
 * the approval record is written first (as the PM), then the approval-level tool is executed with
 * the PM as actor, and executeTool's gate verifies the stored record (rule 2).
 * Rejection escalates the job (confirmed business rule) so the PM decides what happens next.
 */
export async function recordApprovalDecision(
  db: Db,
  args: {
    organizationId: string;
    approvalId: string;
    decision: 'approved' | 'rejected';
    decidedBy: string;
    note: string | null;
    now: Date;
  },
): Promise<{ jobId: string; state: string }> {
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
      actorType: 'pm',
      actorId: args.decidedBy,
      action: `approval.${args.decision}`,
      reason: args.note ?? `Spend ${args.decision}`,
      input: { approvalId: approval.id, amountCents: approval.amountCents },
      outcome: 'ok',
    });

    const job = await getJob(tx, args.organizationId, approval.jobId);
    if (args.decision === 'approved') {
      const r = await executeTool(
        approveSpendTool,
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
      await transitionJob(tx, {
        organizationId: args.organizationId,
        jobId: job.id,
        to: 'ESCALATED',
        actor: pm,
        reason: `PM rejected ${formatNzd(approval.amountCents)}${args.note ? `: ${args.note}` : ''}`,
      });
    }
    const after = await getJob(tx, args.organizationId, job.id);
    return { jobId: after.id, state: after.state };
  });
}

export async function listPendingApprovals(db: Db, organizationId: string) {
  return db
    .select({
      id: approvals.id,
      jobId: approvals.jobId,
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
