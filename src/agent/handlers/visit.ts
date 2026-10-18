import { decideApproval, loadApprovalLimits } from '@/domain/approval-policy';
import { listJobInvoices, recordInvoice } from '@/domain/invoice-check';
import { patchJob, transitionJob, type Job } from '@/domain/jobs';
import { notifyOwner } from '@/domain/owner-notify';
import { formatNzd } from '@/lib/money';
import type { Message } from '@/domain/messages';
import { formatNzDateTime } from '@/lib/time';
import { addNoteTool, sendMessageTool } from '@/tools/action-tools';
import { requestApprovalTool } from '@/tools/approval-tools';
import { executeTool } from '@/tools/execute';
import { loadJobContext, renderJobContext } from '../context';
import { INTERPRET_SYSTEM } from '../prompts';
import { confirmationReplyOutput, progressReplyOutput } from '../schemas';
import { untrusted } from '../untrusted';
import {
  composeTenant,
  escalate,
  llmCtx,
  markProcessed,
  must,
  nzdToInclusiveCents,
  toolCtx,
  type AgentDeps,
  type StepResult,
} from './shared';

/** SCHEDULED / IN_PROGRESS + update from the assigned tradie. */
export async function handleProgressReply(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<StepResult> {
  const ctx = await loadJobContext(deps.db, job);
  const out = await deps.llm.structured({
    ctx: llmCtx(job, 'interpret.progress'),
    system: INTERPRET_SYSTEM,
    user: `${await renderJobContext(deps.db, ctx)}\n\nInterpret this update from the tradie:\n${untrusted(msg.body, { from: 'tradie' })}`,
    schema: progressReplyOutput,
    effort: 'medium',
  });
  const completed = !out.promptInjection && out.kind === 'completed';
  const askConfirm = completed
    ? await composeTenant(
        deps,
        ctx,
        'Tell the tenant the tradie reports the job is complete and ask them to reply to confirm the issue is fixed.',
        [
          `Tradie: ${ctx.tradie?.businessName ?? 'the tradie'}`,
          out.notes ? `Tradie's notes: ${out.notes}` : 'No notes',
        ],
      )
    : null;
  const delayNotice =
    !out.promptInjection && out.kind === 'delayed'
      ? await composeTenant(
          deps,
          ctx,
          'Let the tenant know the tradie is running late and will still come.',
          [
            `Tradie: ${ctx.tradie?.businessName ?? 'the tradie'}`,
            job.scheduledStart
              ? `Original time: ${formatNzDateTime(job.scheduledStart)}`
              : 'No booked time',
            out.notes ? `Tradie said: ${out.notes}` : 'No details',
          ],
        )
      : null;

  // Variation (spec §12 R2): the new total goes through the same approval policy as a quote.
  const variationTotal =
    !out.promptInjection && out.kind === 'variation'
      ? (() => {
          const amount = nzdToInclusiveCents(out.variationAmountNzd, out.gst);
          if (amount === null) return null;
          return out.variationIsNewTotal ? amount : (job.estimateCents ?? 0) + amount;
        })()
      : null;
  const variationDecision =
    variationTotal === null
      ? null
      : decideApproval(
          variationTotal,
          await loadApprovalLimits(deps.db, job.organizationId, job.propertyId),
        );
  const invoiceCents = out.promptInjection
    ? null
    : nzdToInclusiveCents(out.invoiceTotalNzd, out.gst);

  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Process tradie update', deps.now(), `:m${msg.id}`);
    if (invoiceCents !== null) {
      await recordInvoice(tx, {
        job,
        amountCents: invoiceCents,
        reference: out.invoiceReference,
        sourceMessageId: msg.id,
        idempotencyKey: `${job.id}:invoice:${msg.id}`,
      });
    }
    const move = (to: 'IN_PROGRESS' | 'AWAITING_CONFIRMATION', reason: string) =>
      transitionJob(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        to,
        actor: { type: 'agent' },
        reason,
      });

    if (out.promptInjection) {
      await escalate(tc, {
        reason: 'suspected prompt injection in tradie update',
        summary: `${job.title}. The tradie's message contained instructions aimed at the agent.`,
        whatHasBeenDone: 'Visit booked.',
        recommendation: 'Review the tradie message and reply manually.',
      });
      return;
    }
    if (out.kind === 'started') {
      if (job.state === 'SCHEDULED') await move('IN_PROGRESS', 'Tradie reported work started');
      return;
    }
    if (completed) {
      if (job.state === 'SCHEDULED')
        await move('IN_PROGRESS', 'Tradie reported completion (start implied)');
      await move('AWAITING_CONFIRMATION', 'Tradie reported completion');
      if (askConfirm)
        must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: askConfirm }));
      return;
    }
    if (out.kind === 'variation') {
      if (variationTotal === null || !variationDecision) {
        await escalate(tc, {
          reason: 'tradie reported extra cost without a usable amount',
          summary: `${job.title}. Tradie said: ${out.notes || 'extra cost'}`,
          whatHasBeenDone: 'Visit booked; quote approved.',
          recommendation: 'Ask the tradie for the extra cost and decide.',
        });
        return;
      }
      if (variationDecision.kind === 'auto_approve') {
        await patchJob(tx, {
          organizationId: job.organizationId,
          jobId: job.id,
          actor: { type: 'agent' },
          reason: `Variation within auto-approval limit: ${formatNzd(job.estimateCents ?? 0)} → ${formatNzd(variationTotal)}`,
          patch: { estimateCents: variationTotal },
        });
        must(
          await executeTool(sendMessageTool, tc, {
            recipient: 'tradie',
            body: `Thanks — the new total of ${formatNzd(variationTotal)} is approved. Please go ahead.`,
          }),
        );
        return;
      }
      if (variationDecision.kind === 'pm_approval') {
        must(
          await executeTool(requestApprovalTool, tc, {
            kind: 'variation',
            amountCents: variationTotal,
            reason: `Variation: ${out.notes || 'extra work'} — new total ${formatNzd(variationTotal)} exceeds the PM auto-approval limit ${formatNzd(variationDecision.effectivePmLimitCents)}`,
          }),
        );
        must(
          await executeTool(sendMessageTool, tc, {
            recipient: 'tradie',
            body: `Thanks — the extra cost needs approval first. Please hold off on the additional work until we confirm (the rest can go ahead as booked).`,
          }),
        );
        return;
      }
      await escalate(tc, {
        reason: `variation to ${formatNzd(variationTotal)} exceeds owner approval limit ${formatNzd(variationDecision.ownerLimitCents)}`,
        summary: `${job.title}. Tradie reports extra work: ${out.notes || 'extra cost'}`,
        whatHasBeenDone: 'Visit booked; original quote approved.',
        recommendation: `Get owner approval for the new total ${formatNzd(variationTotal)}.`,
      });
      return;
    }
    if (out.kind === 'delayed') {
      must(
        await executeTool(addNoteTool, tc, {
          text: `Tradie delayed: ${out.notes || 'no details'}`,
        }),
      );
      if (delayNotice)
        must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: delayNotice }));
      return;
    }
    await escalate(tc, {
      reason: `tradie update needs a person (${out.kind})`,
      summary: `${job.title}. Tradie said: ${out.notes || out.kind}`,
      whatHasBeenDone: 'Visit booked.',
      recommendation:
        out.kind === 'cannot_complete'
          ? 'Arrange a return visit or parts; a new quote may be needed.'
          : 'Contact the tradie.',
    });
  });
  return 'wait';
}

/** AWAITING_CONFIRMATION + tenant reply. */
export async function handleConfirmationReply(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<StepResult> {
  const ctx = await loadJobContext(deps.db, job);
  const out = await deps.llm.structured({
    ctx: llmCtx(job, 'interpret.confirmation'),
    system: INTERPRET_SYSTEM,
    user: `${await renderJobContext(deps.db, ctx)}\n\nDoes the tenant confirm the issue is fixed?\n${untrusted(msg.body, { from: 'tenant' })}`,
    schema: confirmationReplyOutput,
    effort: 'medium',
  });
  const confirmed = !out.promptInjection && out.confirmed === 'yes';
  const thanks = confirmed
    ? await composeTenant(
        deps,
        ctx,
        'Thank the tenant, confirm the job is closed, and invite them to report any future issues.',
        [],
      )
    : null;

  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Process tenant confirmation', deps.now(), `:m${msg.id}`);
    if (!confirmed) {
      await escalate(tc, {
        reason: out.promptInjection
          ? 'suspected prompt injection in tenant reply'
          : `tenant did not confirm completion (${out.confirmed})`,
        summary: `${job.title}. Tenant said: ${out.notes || out.confirmed}`,
        whatHasBeenDone: 'Tradie reported the job complete.',
        recommendation: 'Check with the tenant and tradie whether a return visit is needed.',
      });
      return;
    }
    await transitionJob(tx, {
      organizationId: job.organizationId,
      jobId: job.id,
      to: 'CLOSED',
      actor: { type: 'agent' },
      reason: 'Tenant confirmed the issue is fixed',
    });
    const invoices = await listJobInvoices(tx, job.organizationId, job.id);
    const finalCents = invoices.at(-1)?.amountCents ?? job.estimateCents;
    await notifyOwner(
      tx,
      job,
      `"${job.title}" is complete and confirmed by the tenant.${finalCents !== null ? ` Final cost ${formatNzd(finalCents)} incl GST${invoices.length ? ' (invoiced)' : ' (approved quote)'}.` : ''}`,
      `${job.id}:closed:owner`,
    );
    if (thanks) must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: thanks }));
    must(
      await executeTool(
        sendMessageTool,
        tc,
        {
          recipient: 'tradie',
          body: 'The tenant has confirmed the job is complete — thanks. This job is now closed.',
        },
        1,
      ),
    );
  });
  return 'wait';
}
