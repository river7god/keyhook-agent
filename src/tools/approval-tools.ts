import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { approvals, properties, tradies } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { getJob, transitionJob } from '@/domain/jobs';
import { queueOutbound } from '@/domain/messages';
import { formatNzd } from '@/lib/money';
import { defineTool } from './types';

/**
 * Ask the PM to approve spend above their auto-approval limit (spec §8, `auto`).
 * Creates the pending approval record, moves the job to AWAITING_APPROVAL and notifies the PM.
 */
export const requestApprovalTool = defineTool({
  name: 'request_approval',
  description: 'Create a PM approval item for spend above the auto-approval limit.',
  permission: 'auto',
  input: z.strictObject({
    amountCents: z.number().int().min(0),
    reason: z.string().min(3).max(500),
  }),
  async run(ctx, input) {
    const job = await getJob(ctx.db, ctx.organizationId, ctx.jobId);
    const [approval] = await ctx.db
      .insert(approvals)
      .values({
        organizationId: ctx.organizationId,
        jobId: ctx.jobId,
        amountCents: input.amountCents,
        reason: input.reason,
        idempotencyKey: `${ctx.idempotencyScope}:request_approval`,
      })
      .returning();
    if (!approval) throw new Error('approval insert failed');
    await transitionJob(ctx.db, {
      organizationId: ctx.organizationId,
      jobId: ctx.jobId,
      to: 'AWAITING_APPROVAL',
      actor: { type: 'agent' },
      reason: input.reason,
    });
    const [property] = await ctx.db
      .select({ pmId: properties.propertyManagerId, address: properties.addressLine1 })
      .from(properties)
      .where(
        and(eq(properties.organizationId, ctx.organizationId), eq(properties.id, job.propertyId)),
      );
    const [tradie] = job.assignedTradieId
      ? await ctx.db
          .select({ name: tradies.businessName })
          .from(tradies)
          .where(
            and(
              eq(tradies.organizationId, ctx.organizationId),
              eq(tradies.id, job.assignedTradieId),
            ),
          )
      : [];
    const ctxRow = property ? { ...property, tradie: tradie?.name ?? null } : null;
    if (ctxRow) {
      await queueOutbound(ctx.db, {
        organizationId: ctx.organizationId,
        jobId: ctx.jobId,
        recipientType: 'pm',
        recipientId: ctxRow.pmId,
        body: `Approval needed: ${job.title} (${ctxRow.address})\nQuote: ${formatNzd(input.amountCents)} from ${ctxRow.tradie ?? 'the tradie'}\nWhy: ${input.reason}\nApprove or reject in the dashboard (Approvals).`,
        idempotencyKey: `${ctx.idempotencyScope}:request_approval:pm`,
      });
    }
    return { approvalId: approval.id, amountCents: approval.amountCents };
  },
});

/**
 * Release approved spend (spec §8, `approval`). executeTool refuses to run this without a stored
 * approved record; the tool additionally checks the specific approval matches this job and quote.
 * Never exposed to the model — invoked only from the PM's decision.
 */
export const approveSpendTool = defineTool({
  name: 'approve_spend',
  description: 'Release approved spend and continue to scheduling.',
  permission: 'approval',
  input: z.strictObject({ approvalId: z.uuid() }),
  async run(ctx, input) {
    const job = await getJob(ctx.db, ctx.organizationId, ctx.jobId);
    const [approval] = await ctx.db
      .select()
      .from(approvals)
      .where(
        and(eq(approvals.organizationId, ctx.organizationId), eq(approvals.id, input.approvalId)),
      );
    if (approval?.jobId !== job.id || approval.status !== 'approved') {
      throw new DomainError('APPROVAL_REQUIRED', 'No approved record for this job');
    }
    if (job.estimateCents !== null && approval.amountCents < job.estimateCents) {
      throw new DomainError('APPROVAL_REQUIRED', 'Approved amount is below the current estimate', {
        approvedCents: approval.amountCents,
        estimateCents: job.estimateCents,
      });
    }
    await transitionJob(ctx.db, {
      organizationId: ctx.organizationId,
      jobId: ctx.jobId,
      to: 'SCHEDULING',
      actor: ctx.actor ?? { type: 'pm' },
      reason: `Spend of ${formatNzd(approval.amountCents)} approved`,
    });
    if (job.assignedTradieId) {
      await queueOutbound(ctx.db, {
        organizationId: ctx.organizationId,
        jobId: ctx.jobId,
        recipientType: 'tradie',
        recipientId: job.assignedTradieId,
        body: `Good news — your quote of ${formatNzd(approval.amountCents)} has been approved. We're confirming a visit time with the tenant and will be in touch shortly.`,
        idempotencyKey: `${ctx.idempotencyScope}:approve_spend:tradie`,
      });
    }
    return { approvalId: approval.id };
  },
});
