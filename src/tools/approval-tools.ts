import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { approvals, properties, tradies } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { getJob, patchJob, transitionJob } from '@/domain/jobs';
import { queueOutbound } from '@/domain/messages';
import { notifyOwner } from '@/domain/owner-notify';
import { formatNzd } from '@/lib/money';
import { defineTool, jobIdOf } from './types';

/**
 * Ask the PM to approve spend above their auto-approval limit (spec §8, `auto`).
 * Creates the pending approval record and notifies the PM and (for information) the owner.
 * A first quote moves the job to AWAITING_APPROVAL; a variation (extra cost reported after the
 * quote was approved, spec §12 R2) leaves the job where it is — only the extra work waits.
 */
export const requestApprovalTool = defineTool({
  name: 'request_approval',
  description: 'Create a PM approval item for spend above the auto-approval limit.',
  permission: 'auto',
  input: z.strictObject({
    amountCents: z.number().int().min(0),
    reason: z.string().min(3).max(500),
    kind: z.enum(['quote', 'variation']).default('quote'),
  }),
  async run(ctx, input) {
    const job = await getJob(ctx.db, ctx.organizationId, jobIdOf(ctx));
    const [approval] = await ctx.db
      .insert(approvals)
      .values({
        organizationId: ctx.organizationId,
        jobId: jobIdOf(ctx),
        kind: input.kind,
        previousAmountCents: input.kind === 'variation' ? job.estimateCents : null,
        amountCents: input.amountCents,
        reason: input.reason,
        idempotencyKey: `${ctx.idempotencyScope}:request_approval`,
      })
      .returning();
    if (!approval) throw new Error('approval insert failed');
    if (input.kind === 'quote') {
      await transitionJob(ctx.db, {
        organizationId: ctx.organizationId,
        jobId: jobIdOf(ctx),
        to: 'AWAITING_APPROVAL',
        actor: { type: 'agent' },
        reason: input.reason,
      });
    }
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
        jobId: jobIdOf(ctx),
        recipientType: 'pm',
        recipientId: ctxRow.pmId,
        body: `${input.kind === 'variation' ? 'Variation' : 'Approval'} needed: ${job.title} (${ctxRow.address})\n${
          input.kind === 'variation' && job.estimateCents !== null
            ? `New total: ${formatNzd(input.amountCents)} (was ${formatNzd(job.estimateCents)})`
            : `Quote: ${formatNzd(input.amountCents)}`
        } from ${ctxRow.tradie ?? 'the tradie'}\nWhy: ${input.reason}\nApprove or reject in the dashboard (Approvals).`,
        idempotencyKey: `${ctx.idempotencyScope}:request_approval:pm`,
      });
    }
    await notifyOwner(
      ctx.db,
      job,
      `${input.kind === 'variation' ? 'A cost variation' : 'A quote'} of ${formatNzd(input.amountCents)} for "${job.title}" is with your property manager for approval.`,
      `${ctx.idempotencyScope}:request_approval:owner`,
    );
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
    const job = await getJob(ctx.db, ctx.organizationId, jobIdOf(ctx));
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
      jobId: jobIdOf(ctx),
      to: 'SCHEDULING',
      actor: ctx.actor ?? { type: 'pm' },
      reason: `Spend of ${formatNzd(approval.amountCents)} approved`,
    });
    if (job.assignedTradieId) {
      await queueOutbound(ctx.db, {
        organizationId: ctx.organizationId,
        jobId: jobIdOf(ctx),
        recipientType: 'tradie',
        recipientId: job.assignedTradieId,
        body: `Good news — your quote of ${formatNzd(approval.amountCents)} has been approved. We're confirming a visit time with the tenant and will be in touch shortly.`,
        idempotencyKey: `${ctx.idempotencyScope}:approve_spend:tradie`,
      });
    }
    return { approvalId: approval.id };
  },
});

/**
 * Release an approved variation (spec §12 R2, `approval`): the job's approved total becomes the
 * new amount and the supplier may go ahead with the extra work. Never exposed to the model.
 */
export const approveVariationTool = defineTool({
  name: 'approve_variation',
  description: 'Release an approved cost variation.',
  permission: 'approval',
  input: z.strictObject({ approvalId: z.uuid() }),
  async run(ctx, input) {
    const job = await getJob(ctx.db, ctx.organizationId, jobIdOf(ctx));
    const [approval] = await ctx.db
      .select()
      .from(approvals)
      .where(
        and(eq(approvals.organizationId, ctx.organizationId), eq(approvals.id, input.approvalId)),
      );
    if (
      approval?.jobId !== job.id ||
      approval.status !== 'approved' ||
      approval.kind !== 'variation'
    ) {
      throw new DomainError('APPROVAL_REQUIRED', 'No approved variation for this job');
    }
    await patchJob(ctx.db, {
      organizationId: ctx.organizationId,
      jobId: job.id,
      actor: ctx.actor ?? { type: 'pm' },
      reason: `Variation approved: ${formatNzd(approval.previousAmountCents ?? 0)} → ${formatNzd(approval.amountCents)}`,
      patch: { estimateCents: approval.amountCents },
    });
    if (job.assignedTradieId) {
      await queueOutbound(ctx.db, {
        organizationId: ctx.organizationId,
        jobId: jobIdOf(ctx),
        recipientType: 'tradie',
        recipientId: job.assignedTradieId,
        body: `The variation is approved — new approved total ${formatNzd(approval.amountCents)}. Please go ahead with the extra work.`,
        idempotencyKey: `${ctx.idempotencyScope}:approve_variation:tradie`,
      });
    }
    return { approvalId: approval.id, approvedCents: approval.amountCents };
  },
});
