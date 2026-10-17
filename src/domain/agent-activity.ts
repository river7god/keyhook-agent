import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditLog, idempotencyKeys, llmCalls, messages } from '@/db/schema';
import type { Job } from './jobs';

/** After this long without any agent activity while work is pending, the UI warns. */
export const STALLED_AFTER_MS = 3 * 60_000;

export interface AgentActivity {
  /** The agent owes the job a next step right now. */
  working: boolean;
  /** When the pending work started (unprocessed message, or the state change that needs it). */
  waitingSince: string | null;
  /** Human-readable last completed step, e.g. "Triaged the request". */
  lastStep: string | null;
  lastActivityAt: string | null;
  /** Working, but nothing has happened for STALLED_AFTER_MS — the background worker may be down. */
  stalled: boolean;
}

const STEP_LABELS: [prefix: string, label: string][] = [
  ['retriage', 'Re-read the request'],
  ['triage', 'Triaged the request'],
  ['act', 'Looked for a tradie'],
  ['interpret.quote', 'Read the quote'],
  ['interpret.slot', 'Read the time choice'],
  ['interpret.progress', 'Read the tradie update'],
  ['interpret.confirmation', 'Read the confirmation'],
  ['interpret', 'Read the reply'],
  ['compose', 'Wrote a reply'],
];
const ACTION_LABELS: Record<string, string> = {
  'job.created': 'Received the request',
  search_tradies: 'Searched for tradies',
  request_quote: 'Requested a quote',
  request_approval: 'Asked the PM to approve',
  schedule_visit: 'Booked the visit',
  escalate: 'Escalated to the PM',
  send_message: 'Sent a message',
};

function stepLabel(step: string): string {
  return STEP_LABELS.find(([p]) => step.startsWith(p))?.[1] ?? 'Thinking';
}

/**
 * What the agent is doing on a job, derived from durable data only (messages, idempotency keys,
 * LLM calls, audit rows) — no extra bookkeeping, so it is also correct after a crash.
 */
export async function getAgentActivity(db: DbOrTx, job: Job, now: Date): Promise<AgentActivity> {
  const org = job.organizationId;
  const [[inbound], [call], [audit]] = await Promise.all([
    db
      .select({ id: messages.id, createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, org),
          eq(messages.jobId, job.id),
          eq(messages.direction, 'inbound'),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1),
    db
      .select({ step: llmCalls.step, createdAt: llmCalls.createdAt })
      .from(llmCalls)
      .where(and(eq(llmCalls.organizationId, org), eq(llmCalls.jobId, job.id)))
      .orderBy(desc(llmCalls.id))
      .limit(1),
    db
      .select({ action: auditLog.action, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, org), eq(auditLog.jobId, job.id)))
      .orderBy(desc(auditLog.id))
      .limit(1),
  ]);

  const [processed] = inbound
    ? await db
        .select({ key: idempotencyKeys.key })
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.organizationId, org),
            eq(idempotencyKeys.key, `inbound:${inbound.id}`),
          ),
        )
    : [];

  const unprocessedMessage = inbound !== undefined && processed === undefined;
  const stateNeedsAgent =
    job.state === 'RECEIVED' ||
    job.state === 'TRIAGED' ||
    (job.state === 'SCHEDULING' && !job.offeredSlotIds?.length);
  const working = unprocessedMessage || stateNeedsAgent;

  const waitingSince = !working ? null : unprocessedMessage ? inbound.createdAt : job.updatedAt;
  const latest = [
    call ? { at: call.createdAt, label: stepLabel(call.step) } : null,
    audit ? { at: audit.createdAt, label: ACTION_LABELS[audit.action] ?? null } : null,
  ]
    .filter((x): x is { at: Date; label: string | null } => x !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const lastActivityAt = latest[0]?.at ?? null;
  const lastStep = latest.find((x) => x.label)?.label ?? null;

  const reference = Math.max(waitingSince?.getTime() ?? 0, lastActivityAt?.getTime() ?? 0);
  return {
    working,
    waitingSince: waitingSince?.toISOString() ?? null,
    lastStep,
    lastActivityAt: lastActivityAt?.toISOString() ?? null,
    stalled: working && now.getTime() - reference > STALLED_AFTER_MS,
  };
}
