import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { messages } from '@/db/schema';
import { ensureFollowUp } from '@/domain/follow-ups';
import { getJob, type Job } from '@/domain/jobs';
import { deliverQueued, type Message } from '@/domain/messages';
import { withSpan } from '@/lib/telemetry';
import { handleGeneralMessage } from './handlers/general';
import { handleQuoteReply, handleTriaged } from './handlers/quote';
import { handleOfferSlots, handleSlotReply } from './handlers/scheduling';
import { escalateOnAgentFailure } from './failures';
import {
  alreadyProcessed,
  DuplicateInboundError,
  type AgentDeps,
  type StepResult,
} from './handlers/shared';
import { LlmOutputError, LlmRefusalError } from './llm';
import { handleClarifyReply, handleReceived } from './handlers/triage';
import { handleConfirmationReply, handleProgressReply } from './handlers/visit';

export type { AgentDeps } from './handlers/shared';

const MAX_STEPS = 6;

type Handler = {
  name: string;
  run: (deps: AgentDeps, job: Job, msg: Message | null) => Promise<StepResult>;
};

/**
 * Advance one job as far as it can go without outside input. Called by the Inngest orchestrator
 * when a job is created, a tenant/tradie message arrives, or a PM decision is recorded
 * (serialised per job).
 *
 * Handlers do their LLM work first, then apply all effects in ONE transaction through executeTool
 * (permissions, idempotency, audit). Afterwards the job's follow-up is (re)scheduled for whatever
 * it is now waiting on, and queued messages are delivered.
 */
export function advanceJob(
  deps: AgentDeps,
  args: { organizationId: string; jobId: string; messageId?: string | null },
): Promise<{ handled: string[] }> {
  return withSpan(
    'job.advance',
    {
      'keyhook.organization_id': args.organizationId,
      'keyhook.job_id': args.jobId,
      ...(args.messageId ? { 'keyhook.message_id': args.messageId } : {}),
    },
    async (span) => {
      const result = await advance(deps, args);
      span.setAttribute('keyhook.handled', result.handled);
      return result;
    },
  );
}

async function advance(
  deps: AgentDeps,
  args: { organizationId: string; jobId: string; messageId?: string | null },
): Promise<{ handled: string[] }> {
  const handled: string[] = [];
  let pending = args.messageId
    ? await loadInbound(deps.db, args.organizationId, args.jobId, args.messageId)
    : null;
  if (pending && (await alreadyProcessed(deps.db, pending))) pending = null;

  for (let i = 0; i < MAX_STEPS; i++) {
    const job = await getJob(deps.db, args.organizationId, args.jobId);
    const step = pickHandler(job, pending);
    if (!step) break;
    handled.push(step.name);
    let result: StepResult;
    try {
      result = await step.run(deps, job, pending);
    } catch (err) {
      if (err instanceof DuplicateInboundError) break; // a concurrent run already handled it
      if (err instanceof LlmRefusalError || err instanceof LlmOutputError) {
        // Retrying won't change a refusal or a malformed answer: hand to a PM now.
        await escalateOnAgentFailure(deps.db, {
          organizationId: args.organizationId,
          jobId: args.jobId,
          reason: err.message,
          now: deps.now(),
        });
        handled.push('escalated_on_failure');
        break;
      }
      throw err;
    }
    pending = null; // an inbound message is consumed by at most one handler
    if (result === 'wait') break;
  }

  const job = await getJob(deps.db, args.organizationId, args.jobId);
  await deps.db.transaction((tx) => ensureFollowUp(tx, job, deps.now()));
  await deliverQueued(deps.db, args.organizationId, args.jobId);
  return { handled };
}

function pickHandler(job: Job, msg: Message | null): Handler | null {
  if (msg) {
    const fromTenant = msg.senderType === 'tenant' && msg.senderId === job.reportedByTenantId;
    const fromTradie = msg.senderType === 'tradie' && msg.senderId === job.assignedTradieId;
    const s = job.state;
    if (s === 'RECEIVED') return { name: 'triage', run: handleReceived };
    if (s === 'NEEDS_INFO' && fromTenant)
      return { name: 'clarify_reply', run: withMsg(handleClarifyReply) };
    if (s === 'AWAITING_QUOTE' && fromTradie)
      return { name: 'quote_reply', run: withMsg(handleQuoteReply) };
    if (s === 'SCHEDULING' && fromTenant && job.offeredSlotIds?.length) {
      return { name: 'slot_reply', run: withMsg(handleSlotReply) };
    }
    if ((s === 'SCHEDULED' || s === 'IN_PROGRESS') && fromTradie) {
      return { name: 'progress_reply', run: withMsg(handleProgressReply) };
    }
    if (s === 'AWAITING_CONFIRMATION' && fromTenant) {
      return { name: 'confirmation_reply', run: withMsg(handleConfirmationReply) };
    }
    return { name: 'general_message', run: withMsg(handleGeneralMessage) };
  }
  if (job.state === 'RECEIVED') return { name: 'triage', run: handleReceived };
  if (job.state === 'TRIAGED') return { name: 'arrange_quote', run: (d, j) => handleTriaged(d, j) };
  if (job.state === 'SCHEDULING' && !job.offeredSlotIds?.length) {
    return { name: 'offer_slots', run: (d, j) => handleOfferSlots(d, j) };
  }
  return null;
}

function withMsg(fn: (deps: AgentDeps, job: Job, msg: Message) => Promise<StepResult>) {
  return (deps: AgentDeps, job: Job, msg: Message | null) => {
    if (!msg) throw new Error('handler requires a message');
    return fn(deps, job, msg);
  };
}

async function loadInbound(db: Db, organizationId: string, jobId: string, messageId: string) {
  const [msg] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.jobId, jobId),
        eq(messages.id, messageId),
      ),
    );
  return msg?.direction === 'inbound' ? msg : null;
}
