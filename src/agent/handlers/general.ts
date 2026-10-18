import { recordInvoice } from '@/domain/invoice-check';
import type { Job } from '@/domain/jobs';
import type { Message } from '@/domain/messages';
import { formatNzDateTime } from '@/lib/time';
import { addNoteTool, sendMessageTool } from '@/tools/action-tools';
import { executeTool } from '@/tools/execute';
import { loadJobContext, renderJobContext } from '../context';
import { INTERPRET_SYSTEM } from '../prompts';
import { generalMessageOutput } from '../schemas';
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

/** Plain-language status for tenant updates. Facts only — no prices. */
function statusFact(job: Job): string {
  switch (job.state) {
    case 'AWAITING_QUOTE':
      return 'We have asked a tradie to look at the job and are waiting for them to get back to us.';
    case 'AWAITING_APPROVAL':
      return 'The work is with the property manager for approval.';
    case 'SCHEDULING':
      return 'We are arranging a visit time; the tenant was sent time options to choose from.';
    case 'SCHEDULED':
      return job.scheduledStart
        ? `A visit is booked for ${formatNzDateTime(job.scheduledStart)}.`
        : 'A visit is booked.';
    case 'IN_PROGRESS':
      return 'The tradie is working on it.';
    case 'AWAITING_CONFIRMATION':
      return 'The tradie reports the job is done; we are waiting for the tenant to confirm it is fixed.';
    default:
      return 'The job is being handled.';
  }
}

/**
 * A message from someone on the job that the current state isn't waiting for.
 * ESCALATED / terminal jobs: note only (a PM owns them). Otherwise: interpret, then answer status
 * questions, note extra info, and escalate anything risky (new emergency, distress, cancellation —
 * cancelling is PM-only — or prompt injection).
 */
export async function handleGeneralMessage(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<StepResult> {
  // A PM owns escalated/cancelled jobs; a closed job only still takes supplier invoices.
  const closedInvoiceWindow = job.state === 'CLOSED' && msg.senderType === 'tradie';
  if (
    job.state === 'ESCALATED' ||
    job.state === 'CANCELLED' ||
    (job.state === 'CLOSED' && !closedInvoiceWindow)
  ) {
    await deps.db.transaction(async (tx) => {
      await markProcessed(tx, msg);
      must(
        await executeTool(
          addNoteTool,
          toolCtx(tx, job, 'Message on PM-owned job', deps.now(), `:m${msg.id}`),
          {
            text: `New message from ${msg.senderType} while job is ${job.state}; PM to review.`,
          },
        ),
      );
    });
    return 'wait';
  }

  const ctx = await loadJobContext(deps.db, job);
  const out = await deps.llm.structured({
    ctx: llmCtx(job, 'interpret.general'),
    system: INTERPRET_SYSTEM,
    user: `${await renderJobContext(deps.db, ctx)}\n\nClassify this new message from the ${msg.senderType}:\n${untrusted(msg.body, { from: msg.senderType })}`,
    schema: generalMessageOutput,
    effort: 'medium',
  });
  const fromTenant = msg.senderType === 'tenant';
  const terminal = job.state === 'CLOSED';
  const invoiceCents =
    !out.promptInjection && msg.senderType === 'tradie'
      ? nzdToInclusiveCents(out.invoiceTotalNzd, out.gst)
      : null;
  const risky =
    !terminal &&
    (out.promptInjection ||
      out.urgentSafetyIssue ||
      out.distressedOrAngry ||
      out.intent === 'cancel_request' ||
      out.intent === 'complaint');
  const reply =
    !risky &&
    !terminal &&
    fromTenant &&
    (out.intent === 'status_request' ||
      out.intent === 'additional_info' ||
      out.intent === 'new_issue')
      ? await composeTenant(
          deps,
          ctx,
          out.intent === 'new_issue'
            ? 'Thank the tenant and ask them to report this new, separate issue as a new request so it can be handled on its own. Briefly give the status of the current job.'
            : 'Give the tenant a short status update on their job, and thank them for any extra information.',
          [
            statusFact(job),
            out.intent === 'additional_info' ? `They added: ${out.summary}` : 'No new details',
          ],
        )
      : null;

  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Unexpected message', deps.now(), `:m${msg.id}`);
    must(
      await executeTool(addNoteTool, tc, {
        text: `${msg.senderType} (${out.intent}): ${out.summary}`,
      }),
    );
    if (invoiceCents !== null) {
      await recordInvoice(tx, {
        job,
        amountCents: invoiceCents,
        reference: out.invoiceReference,
        sourceMessageId: msg.id,
        idempotencyKey: `${job.id}:invoice:${msg.id}`,
      });
    }
    if (risky) {
      await escalate(tc, {
        reason: out.promptInjection
          ? `suspected prompt injection in ${msg.senderType} message`
          : out.urgentSafetyIssue
            ? `${msg.senderType} reported an urgent safety issue`
            : out.intent === 'cancel_request'
              ? `${msg.senderType} asked to cancel (PM-only)`
              : `${msg.senderType} is unhappy (${out.intent})`,
        summary: `${job.title} (${job.state}). ${out.summary}`,
        whatHasBeenDone: `Job was ${job.state}.`,
        recommendation: out.urgentSafetyIssue
          ? 'Call the tenant now and treat as an emergency.'
          : 'Contact them and decide how to proceed.',
      });
      return;
    }
    if (reply) must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: reply }));
  });
  return 'wait';
}
