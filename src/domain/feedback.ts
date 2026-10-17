import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import {
  agentFeedback,
  feedbackKindEnum,
  jobs,
  propertyManagers,
  tradeEnum,
  urgencyEnum,
} from '@/db/schema';
import { writeAudit } from './audit';
import { DomainError } from './errors';
import type { Job } from './jobs';

export const feedbackInputSchema = z
  .strictObject({
    kind: z.enum(feedbackKindEnum.enumValues),
    expectedUrgency: z.enum(urgencyEnum.enumValues).nullable(),
    expectedTrade: z.enum(tradeEnum.enumValues).nullable(),
    note: z.string().trim().max(1000).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'urgency' && !v.expectedUrgency) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedUrgency'],
        message: 'Say what the urgency should have been',
      });
    }
    if (v.kind === 'trade' && !v.expectedTrade) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedTrade'],
        message: 'Say what the trade should have been',
      });
    }
    if (v.kind === 'other' && !v.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Describe what went wrong' });
    }
  });
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

function agentSaw(job: Job) {
  return {
    state: job.state,
    ...(job.urgency ? { urgency: job.urgency } : {}),
    ...(job.trade ? { trade: job.trade } : {}),
    escalate: job.state === 'ESCALATED',
  };
}

/** A PM flags an agent mistake on a job (explicit label). Audited as the PM. */
export async function recordFeedback(
  db: DbOrTx,
  args: { organizationId: string; jobId: string; propertyManagerId: string; input: FeedbackInput },
) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.organizationId, args.organizationId), eq(jobs.id, args.jobId)));
  if (!job) throw new DomainError('NOT_FOUND', 'Job not found');
  const { kind, expectedUrgency, expectedTrade, note } = args.input;
  const expected = {
    ...(expectedUrgency ? { urgency: expectedUrgency } : {}),
    ...(expectedTrade ? { trade: expectedTrade } : {}),
    ...(kind === 'should_have_escalated' ? { escalate: true } : {}),
    ...(kind === 'should_not_have_escalated' ? { escalate: false } : {}),
  };
  const [row] = await db
    .insert(agentFeedback)
    .values({
      organizationId: args.organizationId,
      jobId: job.id,
      propertyManagerId: args.propertyManagerId,
      source: 'pm_flag',
      kind,
      expected,
      agentSaw: agentSaw(job),
      note,
    })
    .returning();
  if (!row) throw new Error('feedback insert failed');
  await writeAudit(db, {
    organizationId: args.organizationId,
    jobId: job.id,
    actorType: 'pm',
    actorId: args.propertyManagerId,
    action: 'agent.feedback',
    reason: note ?? kind,
    input: { kind, expected },
    output: { feedbackId: row.id },
    outcome: 'ok',
  });
  return row;
}

/**
 * Implicit label: a PM handing a job back with a different urgency/trade is telling us the
 * agent's triage was wrong. One row per corrected field.
 */
export async function recordHandBackCorrections(
  db: DbOrTx,
  args: {
    job: Job;
    propertyManagerId: string;
    urgency?: Job['urgency'];
    trade?: Job['trade'];
    note: string | null;
  },
) {
  const rows: (typeof agentFeedback.$inferInsert)[] = [];
  const base = {
    organizationId: args.job.organizationId,
    jobId: args.job.id,
    propertyManagerId: args.propertyManagerId,
    source: 'hand_back_override' as const,
    agentSaw: agentSaw(args.job),
    note: args.note,
  };
  if (args.urgency && args.urgency !== args.job.urgency) {
    rows.push({ ...base, kind: 'urgency', expected: { urgency: args.urgency } });
  }
  if (args.trade && args.trade !== args.job.trade) {
    rows.push({ ...base, kind: 'trade', expected: { trade: args.trade } });
  }
  if (rows.length) await db.insert(agentFeedback).values(rows);
  return rows.length;
}

export async function listFeedback(
  db: DbOrTx,
  organizationId: string,
  opts: { jobId?: string; limit?: number } = {},
) {
  return db
    .select({
      id: agentFeedback.id,
      jobId: agentFeedback.jobId,
      jobTitle: jobs.title,
      source: agentFeedback.source,
      kind: agentFeedback.kind,
      expected: agentFeedback.expected,
      agentSaw: agentFeedback.agentSaw,
      note: agentFeedback.note,
      pm: propertyManagers.fullName,
      harvestedAt: agentFeedback.harvestedAt,
      createdAt: agentFeedback.createdAt,
    })
    .from(agentFeedback)
    .innerJoin(
      jobs,
      and(eq(jobs.organizationId, agentFeedback.organizationId), eq(jobs.id, agentFeedback.jobId)),
    )
    .leftJoin(
      propertyManagers,
      and(
        eq(propertyManagers.organizationId, agentFeedback.organizationId),
        eq(propertyManagers.id, agentFeedback.propertyManagerId),
      ),
    )
    .where(
      opts.jobId
        ? and(eq(agentFeedback.organizationId, organizationId), eq(agentFeedback.jobId, opts.jobId))
        : eq(agentFeedback.organizationId, organizationId),
    )
    .orderBy(desc(agentFeedback.createdAt))
    .limit(opts.limit ?? 100);
}
