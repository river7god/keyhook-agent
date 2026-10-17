import { and, eq } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db/client';
import { idempotencyKeys } from '@/db/schema';
import { satisfyFollowUps } from '@/domain/follow-ups';
import { withIdempotency } from '@/domain/idempotency';
import type { Job } from '@/domain/jobs';
import type { Message } from '@/domain/messages';
import { escalateTool } from '@/tools/action-tools';
import { executeTool, type ToolResult } from '@/tools/execute';
import type { ToolContext } from '@/tools/types';
import type { JobContext } from '../context';
import type { LlmClient } from '../llm';
import { COMPOSE_TENANT_SYSTEM } from '../prompts';
import { composeOutput } from '../schemas';

export interface AgentDeps {
  db: Db;
  llm: LlmClient;
  now: () => Date;
}

/** continue: the job may be able to progress further now; wait: it needs outside input. */
export type StepResult = 'continue' | 'wait';

export const GST_RATE = 0.15;
export const SLOTS_PER_OFFER = 3;

export function llmCtx(job: Job, step: string) {
  return { organizationId: job.organizationId, jobId: job.id, step };
}

/** Idempotency scope = job version, so a retried step reuses keys and a later step gets new ones. */
export function toolCtx(
  db: DbOrTx,
  job: Job,
  reason: string,
  now: Date,
  scopeSuffix = '',
): ToolContext {
  return {
    db,
    organizationId: job.organizationId,
    jobId: job.id,
    reason,
    idempotencyScope: `${job.id}:v${job.version}${scopeSuffix}`,
    now,
  };
}

/** Workflow-driven tool calls must succeed; a failure aborts the transaction (Inngest retries). */
export function must(result: ToolResult): unknown {
  if (!result.ok) throw new Error(`Tool failed: ${result.error.code} ${result.error.message}`);
  return result.output;
}

export async function escalate(
  tc: ToolContext,
  args: { reason: string; summary: string; whatHasBeenDone: string; recommendation: string },
): Promise<void> {
  must(await executeTool(escalateTool, tc, args));
}

export async function composeTenant(
  deps: AgentDeps,
  ctx: JobContext,
  purpose: string,
  facts: string[],
): Promise<string | null> {
  if (!ctx.tenant) return null;
  const out = await deps.llm.structured({
    ctx: llmCtx(ctx.job, 'compose.tenant'),
    system: COMPOSE_TENANT_SYSTEM,
    user: [
      `Tenant first name: ${ctx.tenant.fullName.split(' ')[0] ?? ctx.tenant.fullName}`,
      `Preferred language: ${ctx.tenant.preferredLanguage}`,
      `Job: ${ctx.job.title}`,
      `Purpose: ${purpose}`,
      'Facts:',
      ...(facts.length ? facts.map((f) => `- ${f}`) : ['- (none beyond the purpose)']),
    ].join('\n'),
    schema: composeOutput,
    effort: 'low',
  });
  return out.body.trim();
}

const inboundKey = (msg: Message) => `inbound:${msg.id}`;

export async function alreadyProcessed(db: Db, msg: Message): Promise<boolean> {
  const [row] = await db
    .select({ key: idempotencyKeys.key })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.organizationId, msg.organizationId),
        eq(idempotencyKeys.key, inboundKey(msg)),
      ),
    );
  return row !== undefined;
}

/**
 * An inbound message is acted on at most once, even if the orchestrator retries. A reply from the
 * party we were waiting on also cancels the pending follow-up (a fresh one is scheduled after).
 */
export async function markProcessed(tx: DbOrTx, msg: Message): Promise<void> {
  const { replayed } = await withIdempotency(
    tx,
    {
      organizationId: msg.organizationId,
      key: inboundKey(msg),
      tool: 'process_inbound',
      request: { messageId: msg.id },
    },
    () => Promise.resolve({ processed: true }),
  );
  // Another run processed this message concurrently: abort this transaction (no double effects).
  if (replayed) throw new DuplicateInboundError(msg.id);
  if (msg.jobId) await satisfyFollowUps(tx, msg.organizationId, msg.jobId);
}

export class DuplicateInboundError extends Error {
  constructor(readonly messageId: string) {
    super(`Inbound message ${messageId} was already processed`);
    this.name = 'DuplicateInboundError';
  }
}
