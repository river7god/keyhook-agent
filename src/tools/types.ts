import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';

/** CLAUDE.md rule 2. */
export type Permission = 'read' | 'auto' | 'approval';

export interface ToolContext {
  db: DbOrTx;
  organizationId: string;
  jobId: string;
  /** Agent actions are attributed to the agent; the reason is the "why" in the audit log. */
  reason: string;
  /** Base for deterministic idempotency keys, e.g. "<jobId>:v3". Required for side effects. */
  idempotencyScope: string;
  now: Date;
  traceId?: string | null;
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
