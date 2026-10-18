import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNotNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { approvals, auditLog, invoices, jobs, media, messages, monitorFindings } from '@/db/schema';

/** Live numbers per shipped agent for the Agents page, over the last `days` days. */
export async function agentStats(db: DbOrTx, organizationId: string, now: Date, days = 30) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const org = organizationId;
  const one = <T>(rows: T[]) => rows[0];

  const [open, closed, escalated, photos, variations, invoiceRows, inspections, findings, updates] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(jobs)
        .where(and(eq(jobs.organizationId, org), notInArray(jobs.state, ['CLOSED', 'CANCELLED'])))
        .then(one),
      db
        .select({ n: count() })
        .from(jobs)
        .where(
          and(eq(jobs.organizationId, org), eq(jobs.state, 'CLOSED'), gte(jobs.closedAt, since)),
        )
        .then(one),
      db
        .select({ n: countDistinct(auditLog.jobId) })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, org),
            eq(auditLog.action, 'job.escalation_package'),
            gte(auditLog.createdAt, since),
          ),
        )
        .then(one),
      db
        .select({ n: count() })
        .from(media)
        .where(
          and(
            eq(media.organizationId, org),
            isNotNull(media.analysis),
            gte(media.createdAt, since),
          ),
        )
        .then(one),
      db
        .select({ n: count() })
        .from(approvals)
        .where(
          and(
            eq(approvals.organizationId, org),
            eq(approvals.kind, 'variation'),
            gte(approvals.createdAt, since),
          ),
        )
        .then(one),
      db
        .select({
          matched: sql<number>`count(*) filter (where ${invoices.status} = 'matched')::int`,
          review: sql<number>`count(*) filter (where ${invoices.status} = 'needs_review')::int`,
        })
        .from(invoices)
        .where(and(eq(invoices.organizationId, org), gte(invoices.createdAt, since)))
        .then(one),
      db
        .select({ n: count() })
        .from(jobs)
        .where(
          and(
            eq(jobs.organizationId, org),
            eq(jobs.source, 'inspection'),
            gte(jobs.createdAt, since),
          ),
        )
        .then(one),
      db
        .select({
          open: sql<number>`count(*) filter (where ${monitorFindings.status} = 'open')::int`,
          opened: sql<number>`count(*) filter (where ${monitorFindings.status} = 'opened')::int`,
        })
        .from(monitorFindings)
        .where(eq(monitorFindings.organizationId, org))
        .then(one),
      db
        .select({ n: count() })
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, org),
            eq(messages.direction, 'outbound'),
            inArray(messages.recipientType, ['tenant', 'owner']),
            gte(messages.createdAt, since),
          ),
        )
        .then(one),
    ]);

  return {
    days,
    maintenance: { open: open?.n ?? 0, closed: closed?.n ?? 0, escalated: escalated?.n ?? 0 },
    vision: { analysed: photos?.n ?? 0 },
    variations: {
      variations: variations?.n ?? 0,
      matched: invoiceRows?.matched ?? 0,
      review: invoiceRows?.review ?? 0,
    },
    inspections: { created: inspections?.n ?? 0 },
    monitor: { open: findings?.open ?? 0, opened: findings?.opened ?? 0 },
    updates: { sent: updates?.n ?? 0 },
  };
}
export type AgentStats = Awaited<ReturnType<typeof agentStats>>;
