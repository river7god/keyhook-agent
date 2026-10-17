import { and, asc, count, eq, sum } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { approvals, auditLog, llmCalls, messages } from '@/db/schema';

export type TimelineItem =
  | {
      kind: 'message';
      id: string;
      at: Date;
      direction: 'inbound' | 'outbound';
      from: string;
      to: string;
      body: string;
      status: string;
    }
  | {
      kind: 'transition';
      id: string;
      at: Date;
      from: string;
      to: string;
      actor: string;
      reason: string | null;
    }
  | {
      kind: 'escalation';
      id: string;
      at: Date;
      reason: string;
      summary: string;
      whatHasBeenDone: string;
      recommendation: string;
      evidenceMessageIds: string[];
    }
  | {
      kind: 'triage';
      id: string;
      at: Date;
      urgency: string;
      trade: string;
      confidence: number;
      decision: string;
    }
  | { kind: 'note'; id: string; at: Date; actor: string; text: string }
  | {
      kind: 'action';
      id: string;
      at: Date;
      actor: string;
      action: string;
      outcome: string;
      reason: string | null;
    }
  | {
      kind: 'approval';
      id: string;
      at: Date;
      status: string;
      amountCents: number;
      reason: string;
      decidedBy: string | null;
    };

/** jsonb fields are unknown; only strings are rendered. */
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const SKIP = new Set([
  'job.created',
  'job.patch',
  'search_tradies',
  'get_property',
  'list_jobs_for_property',
]);

/** One chronological story of a job for the PM: messages, decisions, actions, approvals. */
export async function getJobTimeline(db: DbOrTx, organizationId: string, jobId: string) {
  const [msgs, audits, apprs, [cost]] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(and(eq(messages.organizationId, organizationId), eq(messages.jobId, jobId)))
      .orderBy(asc(messages.createdAt)),
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.jobId, jobId)))
      .orderBy(asc(auditLog.id)),
    db
      .select()
      .from(approvals)
      .where(and(eq(approvals.organizationId, organizationId), eq(approvals.jobId, jobId))),
    db
      .select({ micros: sum(llmCalls.costUsdMicros).mapWith(Number), calls: count() })
      .from(llmCalls)
      .where(and(eq(llmCalls.organizationId, organizationId), eq(llmCalls.jobId, jobId))),
  ]);

  const items: TimelineItem[] = [];
  for (const m of msgs) {
    items.push({
      kind: 'message',
      id: m.id,
      at: m.createdAt,
      direction: m.direction,
      from: m.direction === 'inbound' ? m.senderType : m.senderType === 'pm' ? 'pm' : 'agent',
      to: m.direction === 'inbound' ? 'agent' : m.recipientType,
      body: m.body,
      status: m.status,
    });
  }
  for (const a of audits) {
    const id = `audit-${a.id}`;
    const actor = a.actorId ? `${a.actorType} (${a.actorId})` : a.actorType;
    const input = (a.input ?? {}) as Record<string, unknown>;
    const output = (a.output ?? {}) as Record<string, unknown>;
    if (a.action === 'job.transition' && a.outcome === 'ok') {
      items.push({
        kind: 'transition',
        id,
        at: a.createdAt,
        from: String(input.from),
        to: String(input.to),
        actor,
        reason: a.reason,
      });
    } else if (a.action === 'job.escalation_package') {
      items.push({
        kind: 'escalation',
        id,
        at: a.createdAt,
        reason: str(output.reason) || (a.reason ?? ''),
        summary: str(output.summary),
        whatHasBeenDone: str(output.whatHasBeenDone),
        recommendation: str(output.recommendation),
        evidenceMessageIds: Array.isArray(output.evidenceMessageIds)
          ? (output.evidenceMessageIds as string[])
          : [],
      });
    } else if (a.action === 'agent.triage') {
      const t = (output.triage ?? {}) as Record<string, unknown>;
      const d = (output.decision ?? {}) as Record<string, unknown>;
      items.push({
        kind: 'triage',
        id,
        at: a.createdAt,
        urgency: String(t.urgency),
        trade: String(t.trade),
        confidence: Number(t.confidence),
        decision: String(d.action),
      });
    } else if (a.action === 'add_note' && a.outcome === 'ok') {
      items.push({ kind: 'note', id, at: a.createdAt, actor, text: str(input.text) });
    } else if (SKIP.has(a.action) || (a.action === 'send_message' && a.outcome === 'ok')) {
      // Reads and successful sends are already visible (as context or as the message itself).
    } else {
      // Everything else, including rejected transitions and failed tool calls.
      items.push({
        kind: 'action',
        id,
        at: a.createdAt,
        actor,
        action: a.action,
        outcome: a.outcome,
        reason: a.reason,
      });
    }
  }
  for (const ap of apprs) {
    items.push({
      kind: 'approval',
      id: `approval-${ap.id}`,
      at: ap.decidedAt ?? ap.createdAt,
      status: ap.status,
      amountCents: ap.amountCents,
      reason: ap.reason,
      decidedBy: ap.decidedBy,
    });
  }
  items.sort((x, y) => x.at.getTime() - y.at.getTime());
  return { items, llmCostUsdMicros: cost?.micros ?? 0, llmCalls: cost?.calls ?? 0 };
}
