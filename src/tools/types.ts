import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import type { ActorType } from '@/db/schema';

/** CLAUDE.md rule 2. */
export type Permission = 'read' | 'auto' | 'approval';

export interface ToolContext {
  db: DbOrTx;
  organizationId: string;
  /** What the tool acts on: a work order, or an arrears case (spec §12 R8). Exactly one. */
  jobId: string | null;
  arrearsCaseId?: string | null;
  /** Who is acting. Defaults to the agent; PM-initiated actions (approve_spend) pass the PM. */
  actor?: { type: ActorType; id?: string | null };
  /** The "why" recorded in the audit log. */
  reason: string;
  /** Base for deterministic idempotency keys, e.g. "<jobId>:v3". Required for side effects. */
  idempotencyScope: string;
  now: Date;
  traceId?: string | null;
}

/** For work-order tools: the job this call is about (a programming error if missing). */
export function jobIdOf(ctx: ToolContext): string {
  if (!ctx.jobId) throw new Error('This tool needs a work order (ctx.jobId)');
  return ctx.jobId;
}

/** For arrears tools: the case this call is about. */
export function arrearsCaseIdOf(ctx: ToolContext): string {
  if (!ctx.arrearsCaseId) throw new Error('This tool needs an arrears case (ctx.arrearsCaseId)');
  return ctx.arrearsCaseId;
}

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  permission: Permission;
  input: z.ZodType<I>;
  run(ctx: ToolContext, input: I): Promise<O>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous tool registry
export type AnyTool = ToolDefinition<any, any>;

export function defineTool<I, O>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return def;
}

/** Tool definition as sent to Claude. Only read/auto tools are ever exposed to the model. */
export function toAnthropicTool(tool: AnyTool): Anthropic.Beta.BetaTool {
  if (tool.permission === 'approval') {
    throw new Error(`Approval-level tool ${tool.name} must never be exposed to the model`);
  }
  const schema = z.toJSONSchema(tool.input, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
  };
}
