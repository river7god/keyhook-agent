import { and, asc, desc, eq, gte, ne, notInArray } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { jobs, monitorFindings, properties, type Trade } from '@/db/schema';
import { formatNzDate } from '@/lib/time';
import { writeAudit } from './audit';
import { DomainError } from './errors';
import { createAgencyJob, type Job } from './jobs';

/**
 * Portfolio Monitor (spec §12 R7, agents.md). Rules only — no model call: it counts jobs and
 * proposes. A PM decides whether a finding becomes a job; the monitor never dispatches.
 *
 * Repeated fault (confirmed 2026-10-18): ≥ 3 jobs of the same trade at one property within 12
 * months. Cancelled jobs and the monitor's own jobs do not count. A dismissed or opened finding
 * is raised again only when a new job adds to the evidence.
 */
export const REPEATED_FAULT = { minJobs: 3, windowDays: 365 } as const;

export type MonitorFinding = typeof monitorFindings.$inferSelect;

interface Group {
  propertyId: string;
  address: string;
  trade: Trade;
  jobs: { id: string; title: string; description: string; createdAt: Date }[];
}

export async function scanRepeatedFaults(
  tx: DbOrTx,
  organizationId: string,
  now: Date,
): Promise<{ created: number; updated: number }> {
  const since = new Date(now.getTime() - REPEATED_FAULT.windowDays * 86_400_000);
  const rows = await tx
    .select({
      id: jobs.id,
      propertyId: jobs.propertyId,
      address: properties.addressLine1,
      trade: jobs.trade,
      title: jobs.title,
      description: jobs.description,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(
      properties,
      and(eq(properties.organizationId, jobs.organizationId), eq(properties.id, jobs.propertyId)),
    )
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        gte(jobs.createdAt, since),
        ne(jobs.state, 'CANCELLED'),
        ne(jobs.source, 'agent_detected'),
        notInArray(jobs.trade, ['other']),
      ),
    )
    .orderBy(asc(jobs.createdAt));

  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (!r.trade) continue;
    const key = `${r.propertyId}:${r.trade}`;
    const g = groups.get(key) ?? {
      propertyId: r.propertyId,
      address: r.address,
      trade: r.trade,
      jobs: [],
    };
    g.jobs.push({ id: r.id, title: r.title, description: r.description, createdAt: r.createdAt });
    groups.set(key, g);
  }

  let created = 0;
  let updated = 0;
  for (const g of groups.values()) {
    if (g.jobs.length < REPEATED_FAULT.minJobs) continue;
    const evidence = g.jobs.map((j) => j.id);
    const text = describe(g);
    const [latest] = await tx
      .select()
      .from(monitorFindings)
      .where(
        and(
          eq(monitorFindings.organizationId, organizationId),
          eq(monitorFindings.propertyId, g.propertyId),
          eq(monitorFindings.kind, 'repeated_fault'),
          eq(monitorFindings.trade, g.trade),
        ),
      )
      .orderBy(desc(monitorFindings.detectedAt))
      .limit(1);

    if (latest?.status === 'open') {
      if (sameSet(latest.evidenceJobIds, evidence)) continue;
      await tx
        .update(monitorFindings)
        .set({ evidenceJobIds: evidence, ...text, updatedAt: now })
        .where(eq(monitorFindings.id, latest.id));
      updated++;
      continue;
    }
    if (latest && evidence.every((id) => latest.evidenceJobIds.includes(id))) continue;

    const [row] = await tx
      .insert(monitorFindings)
      .values({
        organizationId,
        propertyId: g.propertyId,
        kind: 'repeated_fault',
        trade: g.trade,
        evidenceJobIds: evidence,
        ...text,
        detectedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) continue; // a concurrent scan raised it first
    await writeAudit(tx, {
      organizationId,
      actorType: 'agent',
      action: 'monitor.finding',
      reason: text.summary,
      output: { findingId: row.id, propertyId: g.propertyId, trade: g.trade, evidence },
      outcome: 'ok',
    });
    created++;
  }
  return { created, updated };
}

function describe(g: Group): { summary: string; recommendation: string } {
  const list = g.jobs.map((j) => `${j.title} (${formatNzDate(j.createdAt)})`).join('; ');
  const last = g.jobs.at(-1);
  return {
    summary: `${g.jobs.length} ${g.trade} jobs at ${g.address} in the last 12 months: ${list}.`,
    recommendation:
      `Repeated repairs suggest an underlying fault. Consider asking a ${g.trade} tradie to quote a ` +
      `permanent fix or replacement (owner approval applies to large costs).` +
      (last ? ` Latest job notes: "${last.description.slice(0, 300)}"` : ''),
  };
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function listOpenFindings(db: DbOrTx, organizationId: string) {
  return db
    .select({
      id: monitorFindings.id,
      propertyId: monitorFindings.propertyId,
      address: properties.addressLine1,
      suburb: properties.suburb,
      trade: monitorFindings.trade,
      summary: monitorFindings.summary,
      recommendation: monitorFindings.recommendation,
      evidenceJobIds: monitorFindings.evidenceJobIds,
      detectedAt: monitorFindings.detectedAt,
    })
    .from(monitorFindings)
    .innerJoin(
      properties,
      and(
        eq(properties.organizationId, monitorFindings.organizationId),
        eq(properties.id, monitorFindings.propertyId),
      ),
    )
    .where(
      and(eq(monitorFindings.organizationId, organizationId), eq(monitorFindings.status, 'open')),
    )
    .orderBy(desc(monitorFindings.detectedAt));
}

async function claimOpen(tx: DbOrTx, organizationId: string, findingId: string) {
  const [f] = await tx
    .select()
    .from(monitorFindings)
    .where(
      and(eq(monitorFindings.organizationId, organizationId), eq(monitorFindings.id, findingId)),
    )
    .for('update');
  if (!f) throw new DomainError('NOT_FOUND', 'Finding not found', { findingId });
  if (f.status !== 'open') {
    throw new DomainError('CONFLICT', `Finding already ${f.status}`, { findingId });
  }
  return f;
}

/** PM turns a finding into a job; the agent then triages it like any other. */
export async function openFinding(
  tx: DbOrTx,
  args: {
    organizationId: string;
    findingId: string;
    propertyManagerId: string;
    note: string | null;
    now: Date;
  },
): Promise<Job> {
  const f = await claimOpen(tx, args.organizationId, args.findingId);
  const job = await createAgencyJob(tx, {
    organizationId: args.organizationId,
    propertyId: f.propertyId,
    source: 'agent_detected',
    actor: { type: 'pm', id: args.propertyManagerId },
    title: `Repeated ${f.trade} fault`,
    description: [f.summary, f.recommendation, args.note && `PM note: ${args.note}`]
      .filter(Boolean)
      .join('\n'),
    reason: 'PM opened a Portfolio Monitor finding',
  });
  await tx
    .update(monitorFindings)
    .set({
      status: 'opened',
      openedJobId: job.id,
      decidedBy: args.propertyManagerId,
      decisionNote: args.note,
      decidedAt: args.now,
      updatedAt: args.now,
    })
    .where(eq(monitorFindings.id, f.id));
  await writeAudit(tx, {
    organizationId: args.organizationId,
    jobId: job.id,
    actorType: 'pm',
    actorId: args.propertyManagerId,
    action: 'monitor.opened',
    reason: args.note ?? 'Opened from Portfolio Monitor',
    input: { findingId: f.id },
    output: { jobId: job.id },
    outcome: 'ok',
  });
  return job;
}

export async function dismissFinding(
  tx: DbOrTx,
  args: {
    organizationId: string;
    findingId: string;
    propertyManagerId: string;
    note: string | null;
    now: Date;
  },
): Promise<void> {
  const f = await claimOpen(tx, args.organizationId, args.findingId);
  await tx
    .update(monitorFindings)
    .set({
      status: 'dismissed',
      decidedBy: args.propertyManagerId,
      decisionNote: args.note,
      decidedAt: args.now,
      updatedAt: args.now,
    })
    .where(eq(monitorFindings.id, f.id));
  await writeAudit(tx, {
    organizationId: args.organizationId,
    actorType: 'pm',
    actorId: args.propertyManagerId,
    action: 'monitor.dismissed',
    reason: args.note ?? 'Dismissed',
    input: { findingId: f.id },
    outcome: 'ok',
  });
}
