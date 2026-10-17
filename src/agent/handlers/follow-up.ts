import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { followUps, properties, tradieAvailability, type FollowUpKind } from '@/db/schema';
import {
  FOLLOW_UP_STATES,
  loadWorkflowPolicy,
  scheduleFollowUp,
  type FollowUp,
} from '@/domain/follow-ups';
import { getJob, type Job } from '@/domain/jobs';
import { deliverQueued, queueOutbound } from '@/domain/messages';
import type { WorkflowPolicy } from '@/domain/workflow-policy-config';
import { formatNzd } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { sendMessageTool } from '@/tools/action-tools';
import { executeTool } from '@/tools/execute';
import { loadJobContext, type JobContext } from '../context';
import { reassignTradie } from './quote';
import { composeTenant, escalate, must, toolCtx, type AgentDeps } from './shared';

export type FollowUpOutcome = 'skipped' | 'reminded' | 'reassigned' | 'escalated';

const hoursFrom = (now: Date, h: number) => new Date(now.getTime() + h * 3_600_000);

/** Tenant reminder wording per wait. */
const TENANT_REMINDER: Partial<Record<FollowUpKind, string>> = {
  info_chase:
    'Gently remind the tenant we need a bit more information before we can arrange a tradie, and repeat the question.',
  slot_chase:
    'Remind the tenant to reply with the option number of the visit time that suits (options repeated in facts).',
  confirmation_chase: 'Ask the tenant to reply to confirm whether the issue has been fixed.',
};

const TENANT_ESCALATION: Partial<Record<FollowUpKind, string>> = {
  info_chase: 'tenant did not answer the clarifying question',
  slot_chase: 'tenant did not choose a visit time',
  confirmation_chase: 'tenant did not confirm completion',
};

/**
 * Act on one due follow-up. The follow-up is claimed (scheduled → sent) inside the transaction, so
 * duplicate events or retries act at most once. A follow-up whose wait is over (job moved on) is
 * marked satisfied and skipped.
 */
export async function handleFollowUp(
  deps: AgentDeps,
  followUpId: string,
): Promise<FollowUpOutcome> {
  const [fu] = await deps.db.select().from(followUps).where(eq(followUps.id, followUpId));
  if (fu?.status !== 'scheduled') return 'skipped';
  const job = await getJob(deps.db, fu.organizationId, fu.jobId);
  if (!FOLLOW_UP_STATES[fu.kind].includes(job.state)) {
    await deps.db.update(followUps).set({ status: 'satisfied' }).where(eq(followUps.id, fu.id));
    return 'skipped';
  }
  const policy = await loadWorkflowPolicy(deps.db, job.organizationId);
  const ctx = await loadJobContext(deps.db, job);
  const now = deps.now();

  // LLM composition (tenant reminders) happens before the write transaction.
  const tenantReminder =
    fu.attempt === 1 && TENANT_REMINDER[fu.kind]
      ? await composeTenant(
          deps,
          ctx,
          TENANT_REMINDER[fu.kind] as string,
          await reminderFacts(deps, job, ctx),
        )
      : null;

  let outcome: FollowUpOutcome = 'skipped';
  await deps.db.transaction(async (tx) => {
    if (!(await claim(tx, fu))) return;
    const tc = toolCtx(tx, job, `Follow-up ${fu.kind} #${fu.attempt}`, now, `:fu${fu.id}`);
    const next = (attempt: number, dueAt: Date) =>
      scheduleFollowUp(tx, {
        job,
        kind: fu.kind,
        attempt,
        dueAt,
        targetType: fu.targetType,
        targetId: fu.targetId,
        policy,
      });

    switch (fu.kind) {
      case 'info_chase':
      case 'slot_chase':
      case 'confirmation_chase': {
        if (fu.attempt === 1 && tenantReminder) {
          must(
            await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: tenantReminder }),
          );
          await next(2, hoursFrom(now, escalateAfter(fu.kind, policy)));
          outcome = 'reminded';
          return;
        }
        await escalate(tc, {
          reason: TENANT_ESCALATION[fu.kind] ?? 'tenant did not reply',
          summary: `${job.title} (${job.state}). No reply from the tenant after a reminder.`,
          whatHasBeenDone: `Sent the tenant a reminder ${formatNzDateTime(fu.createdAt)}.`,
          recommendation: 'Phone the tenant.',
        });
        outcome = 'escalated';
        return;
      }
      case 'quote_chase': {
        if (fu.attempt <= policy.quote.maxReminders) {
          must(
            await executeTool(sendMessageTool, tc, {
              recipient: 'tradie',
              body: `Hi, just following up on our quote request for ${job.title} in ${ctx.property.suburb}. Could you reply with a quote (incl. GST), or let us know if you can't take it?`,
            }),
          );
          await next(
            fu.attempt + 1,
            hoursFrom(now, policy.quote.reminderAfterHours[job.urgency ?? 'routine']),
          );
          outcome = 'reminded';
          return;
        }
        // spec §7: unresponsive after the allowed follow-ups → try the next tradie, escalate if none.
        const r = await reassignTradie(
          tx,
          deps,
          job,
          `${ctx.tradie?.businessName ?? 'Tradie'} did not reply after ${policy.quote.maxReminders} follow-up(s)`,
          true,
          `:fu${fu.id}`,
        );
        outcome = r;
        return;
      }
      case 'visit_check': {
        if (fu.attempt === 1) {
          must(
            await executeTool(sendMessageTool, tc, {
              recipient: 'tradie',
              body: `Hi, how did the visit for ${job.title} go? Reply "done" when it's complete, or tell us if another visit or parts are needed.`,
            }),
          );
          await next(2, hoursFrom(now, policy.visit.escalateAfterHours));
          outcome = 'reminded';
          return;
        }
        await escalate(tc, {
          reason: 'no update from the tradie after the booked visit',
          summary: `${job.title}. Visit was booked${job.scheduledStart ? ` for ${formatNzDateTime(job.scheduledStart)}` : ''}; the tradie has not reported progress.`,
          whatHasBeenDone: 'Asked the tradie for an update.',
          recommendation: 'Call the tradie and the tenant to find out whether the visit happened.',
        });
        outcome = 'escalated';
        return;
      }
      case 'approval_chase': {
        await remindPm(tx, job, fu);
        outcome = 'reminded';
        return;
      }
    }
  });
  await deliverQueued(deps.db, job.organizationId, job.id);
  return outcome;
}

function escalateAfter(kind: FollowUpKind, p: WorkflowPolicy): number {
  if (kind === 'info_chase') return p.clarify.escalateAfterHours;
  if (kind === 'slot_chase') return p.slot.escalateAfterHours;
  return p.confirmation.escalateAfterHours;
}

async function reminderFacts(deps: AgentDeps, job: Job, ctx: JobContext): Promise<string[]> {
  if (job.state === 'SCHEDULING' && job.offeredSlotIds?.length) {
    const rows = await deps.db
      .select()
      .from(tradieAvailability)
      .where(inArray(tradieAvailability.id, job.offeredSlotIds));
    return job.offeredSlotIds
      .map((id) => rows.find((r) => r.id === id))
      .filter((r) => r !== undefined)
      .map(
        (s, i) =>
          `Option ${i + 1}: ${formatNzDateTime(s.startsAt)} – ${formatNzDateTime(s.endsAt)}`,
      );
  }
  return [`Job: ${ctx.job.summary ?? ctx.job.title}`];
}

async function claim(tx: DbOrTx, fu: FollowUp): Promise<boolean> {
  const rows = await tx
    .update(followUps)
    .set({ status: 'sent' })
    .where(and(eq(followUps.id, fu.id), eq(followUps.status, 'scheduled')))
    .returning({ id: followUps.id });
  return rows.length === 1;
}

async function remindPm(tx: DbOrTx, job: Job, fu: FollowUp) {
  const [p] = await tx
    .select({ pmId: properties.propertyManagerId, address: properties.addressLine1 })
    .from(properties)
    .where(
      and(eq(properties.organizationId, job.organizationId), eq(properties.id, job.propertyId)),
    );
  if (!p) return;
  await queueOutbound(tx, {
    organizationId: job.organizationId,
    jobId: job.id,
    recipientType: 'pm',
    recipientId: p.pmId,
    body: `Reminder: approval still pending for ${job.title} (${p.address})${job.estimateCents !== null ? ` — ${formatNzd(job.estimateCents)}` : ''}.`,
    idempotencyKey: `followup:${fu.id}:pm`,
  });
}
