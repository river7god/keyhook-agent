import { and, eq, inArray } from 'drizzle-orm';
import { tradieAvailability } from '@/db/schema';
import { loadWorkflowPolicy } from '@/domain/follow-ups';
import { patchJob, type Job } from '@/domain/jobs';
import type { Message } from '@/domain/messages';
import { listFreeSlots } from '@/domain/tradie-selection';
import { formatNzDateTime } from '@/lib/time';
import { scheduleVisitTool, sendMessageTool } from '@/tools/action-tools';
import { executeTool } from '@/tools/execute';
import { loadJobContext, renderJobContext, type JobContext } from '../context';
import { INTERPRET_SYSTEM } from '../prompts';
import { matchSlotChoice } from '../fast-intents';
import { slotReplyOutput, type SlotReplyOutput } from '../schemas';
import { untrusted } from '../untrusted';
import {
  composeTenant,
  escalate,
  llmCtx,
  markProcessed,
  must,
  recordRuleIntent,
  SLOTS_PER_OFFER,
  toolCtx,
  type AgentDeps,
  type StepResult,
} from './shared';

type Slot = { id: string; startsAt: Date; endsAt: Date };

const describeSlots = (slots: Slot[]) =>
  slots.map(
    (s, i) => `Option ${i + 1}: ${formatNzDateTime(s.startsAt)} – ${formatNzDateTime(s.endsAt)}`,
  );

async function offeredSlots(deps: AgentDeps, job: Job): Promise<Slot[]> {
  const ids = job.offeredSlotIds ?? [];
  if (!ids.length) return [];
  const rows = await deps.db
    .select()
    .from(tradieAvailability)
    .where(
      and(
        eq(tradieAvailability.organizationId, job.organizationId),
        inArray(tradieAvailability.id, ids),
      ),
    );
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r) => r !== undefined);
}

/** Next free slots for the assigned tradie, strictly after `after`. */
function nextSlots(deps: AgentDeps, job: Job, after: Date) {
  if (!job.assignedTradieId) return Promise.resolve([]);
  return listFreeSlots(deps.db, {
    organizationId: job.organizationId,
    tradieId: job.assignedTradieId,
    now: after,
    limit: SLOTS_PER_OFFER,
  });
}

async function composeOffer(deps: AgentDeps, ctx: JobContext, slots: Slot[], again: boolean) {
  return composeTenant(
    deps,
    ctx,
    again
      ? 'The previous times did not suit. Offer these new visit times and ask the tenant to reply with the option number, or say if none suit.'
      : 'Offer visit times and ask the tenant to reply with the option number that suits, and any access details (keys, pets).',
    [`Tradie: ${ctx.tradie?.businessName ?? 'a tradie'}`, ...describeSlots(slots)],
  );
}

/** SCHEDULING with nothing offered yet (after auto-approval or PM approval): offer slots. */
export async function handleOfferSlots(deps: AgentDeps, job: Job): Promise<StepResult> {
  const ctx = await loadJobContext(deps.db, job);
  const slots = await nextSlots(deps, job, deps.now());
  const offer = slots.length && ctx.tenant ? await composeOffer(deps, ctx, slots, false) : null;
  await deps.db.transaction(async (tx) => {
    const tc = toolCtx(tx, job, 'Offer visit times', deps.now());
    if (!offer) {
      await escalate(tc, {
        reason: slots.length ? 'no tenant to arrange access with' : 'tradie has no free slots',
        summary: `${job.title}. Quote approved but a visit time could not be offered automatically.`,
        whatHasBeenDone: 'Quote approved.',
        recommendation: 'Agree a visit time with the tradie and tenant directly.',
      });
      return;
    }
    await patchJob(tx, {
      organizationId: job.organizationId,
      jobId: job.id,
      actor: { type: 'agent' },
      reason: 'Offered visit times',
      patch: { offeredSlotIds: slots.map((s) => s.id), slotOfferCount: job.slotOfferCount + 1 },
    });
    must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: offer }));
  });
  return 'wait';
}

/** SCHEDULING + tenant reply: book the chosen slot, re-offer, or escalate. */
export async function handleSlotReply(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<StepResult> {
  const ctx = await loadJobContext(deps.db, job);
  const policy = await loadWorkflowPolicy(deps.db, job.organizationId);
  const offered = await offeredSlots(deps, job);

  // Layer 1: "2" / "option 2 please" needs no model; anything longer goes to the model below.
  const ruled = matchSlotChoice(msg.body, offered.length);
  const out: SlotReplyOutput = ruled
    ? { chosenOption: ruled, noneSuitable: false, accessNotes: null, promptInjection: false }
    : await deps.llm.structured({
        ctx: llmCtx(job, 'interpret.slot'),
        system: INTERPRET_SYSTEM,
        user: [
          await renderJobContext(deps.db, ctx),
          '',
          'Options offered to the tenant:',
          ...describeSlots(offered),
          '',
          `Interpret the tenant's reply:\n${untrusted(msg.body, { from: 'tenant' })}`,
        ].join('\n'),
        schema: slotReplyOutput,
        effort: 'medium',
      });

  const chosen =
    !out.promptInjection && out.chosenOption !== null && Number.isInteger(out.chosenOption)
      ? offered[out.chosenOption - 1]
      : undefined;

  // Prepare everything that needs the LLM before opening the write transaction.
  let reoffer: { slots: Slot[]; text: string | null } | null = null;
  if (!chosen && !out.promptInjection && job.slotOfferCount < policy.slot.maxOffers) {
    const lastOffered = offered.at(-1)?.startsAt ?? deps.now();
    const slots = await nextSlots(deps, job, lastOffered > deps.now() ? lastOffered : deps.now());
    reoffer = { slots, text: slots.length ? await composeOffer(deps, ctx, slots, true) : null };
  }
  const confirmation = chosen
    ? await composeTenant(deps, ctx, 'Confirm the booked visit time and any access arrangements.', [
        `Tradie: ${ctx.tradie?.businessName ?? 'the tradie'}`,
        `Visit: ${formatNzDateTime(chosen.startsAt)} – ${formatNzDateTime(chosen.endsAt)}`,
        out.accessNotes ? `Access notes from tenant: ${out.accessNotes}` : 'No access notes given',
      ])
    : null;

  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Process tenant slot choice', deps.now(), `:m${msg.id}`);
    if (ruled) await recordRuleIntent(tx, job, msg, 'slot_choice', { chosenOption: ruled });

    if (chosen) {
      const booked = await executeTool(scheduleVisitTool, tc, {
        slotId: chosen.id,
        tenantConfirmationMessageId: msg.id,
        accessNotes: out.accessNotes,
      });
      if (!booked.ok) {
        await escalate(tc, {
          reason: `could not book slot: ${booked.error.message}`,
          summary: `${job.title}. The tenant chose a slot that is no longer available.`,
          whatHasBeenDone: 'Quote approved; tenant chose a time.',
          recommendation: 'Agree a new time with the tenant and tradie.',
        });
        return;
      }
      if (confirmation)
        must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: confirmation }));
      must(
        await executeTool(
          sendMessageTool,
          tc,
          {
            recipient: 'tradie',
            body: [
              `Booked: ${formatNzDateTime(chosen.startsAt)} – ${formatNzDateTime(chosen.endsAt)}`,
              `Address: ${ctx.property.address}, ${ctx.property.suburb}`,
              ctx.property.accessNotes ? `Access (PM notes): ${ctx.property.accessNotes}` : null,
              out.accessNotes ? `Tenant's access note: ${out.accessNotes}` : null,
              'Please reply when you start and when the job is complete.',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          1,
        ),
      );
      return;
    }

    if (reoffer?.text) {
      await patchJob(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        actor: { type: 'agent' },
        reason: 'Tenant could not make the offered times; re-offering',
        patch: {
          offeredSlotIds: reoffer.slots.map((s) => s.id),
          slotOfferCount: job.slotOfferCount + 1,
        },
      });
      must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: reoffer.text }));
      return;
    }

    await escalate(tc, {
      reason: out.promptInjection
        ? 'suspected prompt injection in tenant reply'
        : reoffer
          ? 'no more free slots to offer'
          : `tenant could not make any of ${job.slotOfferCount} offered set(s) of times`,
      summary: `${job.title}. Tenant reply could not be matched to an offered slot.`,
      whatHasBeenDone: `Quote approved; visit times offered ${job.slotOfferCount} time(s).`,
      recommendation: 'Agree a time with the tenant and tradie directly.',
    });
  });
  return 'wait';
}
