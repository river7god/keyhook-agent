import { and, eq } from 'drizzle-orm';
import { approvals } from '@/db/schema';
import { writeAudit } from '@/domain/audit';
import { DomainError, isDomainError } from '@/domain/errors';
import { withIdempotency } from '@/domain/idempotency';
import type { AnyTool, ToolContext } from './types';

export type ToolResult =
  | { ok: true; output: unknown; replayed: boolean }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

/**
 * The single entry point for running a tool, whether the caller is the LLM or workflow code.
 * Validates input (Zod), enforces the permission level (rule 2), makes side effects idempotent
 * (rule 3) and writes exactly one audit row per call (rule 4). Never throws for tool-level
 * failures — the model gets a structured error it can react to.
 */
export async function executeTool(
  tool: AnyTool,
  ctx: ToolContext,
  rawInput: unknown,
  callIndex = 0,
): Promise<ToolResult> {
  const parsed = tool.input.safeParse(rawInput);
  const idempotencyKey =
    tool.permission === 'read' ? null : `${ctx.idempotencyScope}:${tool.name}:${callIndex}`;

  const audit = (outcome: 'ok' | 'rejected' | 'error', output: unknown) =>
    writeAudit(ctx.db, {
      organizationId: ctx.organizationId,
      jobId: ctx.jobId,
      actorType: ctx.actor?.type ?? 'agent',
      actorId: ctx.actor?.id ?? null,
      action: tool.name,
      reason: ctx.reason,
      input: rawInput,
      output,
      outcome,
      idempotencyKey,
      traceId: ctx.traceId ?? null,
    });

  if (!parsed.success) {
    const error = {
      code: 'VALIDATION',
      message: 'Invalid tool input',
      details: parsed.error.issues,
    };
    await audit('rejected', { error });
    return { ok: false, error };
  }

  try {
    if (tool.permission === 'approval') {
      const [approved] = await ctx.db
        .select({ id: approvals.id })
        .from(approvals)
        .where(
          and(
            eq(approvals.organizationId, ctx.organizationId),
            eq(approvals.jobId, ctx.jobId),
            eq(approvals.status, 'approved'),
          ),
        )
        .limit(1);
      if (!approved) {
        throw new DomainError(
          'APPROVAL_REQUIRED',
          `${tool.name} requires a stored manager approval`,
        );
      }
    }

    let output: unknown;
    let replayed = false;
    if (idempotencyKey) {
      // Savepoint: a failing tool rolls back its own writes and its idempotency key together.
      const r = await ctx.db.transaction((sp) =>
        withIdempotency(
          sp,
          {
            organizationId: ctx.organizationId,
            key: idempotencyKey,
            tool: tool.name,
            request: parsed.data,
          },
          () => tool.run({ ...ctx, db: sp }, parsed.data),
        ),
      );
      output = r.result;
      replayed = r.replayed;
    } else {
      output = await tool.run(ctx, parsed.data);
    }
    await audit('ok', { result: output, replayed });
    return { ok: true, output, replayed };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const error = { code: err.code, message: err.message, details: err.details };
    await audit('rejected', { error });
    return { ok: false, error };
  }
}
