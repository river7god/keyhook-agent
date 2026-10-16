import type { DbOrTx } from '@/db/client';
import { auditLog } from '@/db/schema';
import type { ActorType, AuditOutcome } from '@/db/schema';

export interface AuditEntry {
  organizationId: string;
  jobId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  /** Tool name or event, e.g. "send_message", "job.transition". */
  action: string;
  /** Why the actor did this. Required for agent actions by convention. */
  reason?: string | null;
  input?: unknown;
  output?: unknown;
  outcome: AuditOutcome;
  idempotencyKey?: string | null;
  traceId?: string | null;
}

/**
 * Write one audit row (rule 4). Pass the same transaction as the action it records so the
 * action and its audit entry commit or roll back together.
 */
export async function writeAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    organizationId: entry.organizationId,
    jobId: entry.jobId ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    reason: entry.reason ?? null,
    input: entry.input ?? null,
    output: entry.output ?? null,
    outcome: entry.outcome,
    idempotencyKey: entry.idempotencyKey ?? null,
    traceId: entry.traceId ?? null,
  });
}
