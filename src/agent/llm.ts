import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { llmCalls } from '@/db/schema';
import { trace } from '@opentelemetry/api';
import { withSpan } from '@/lib/telemetry';
import { costUsdMicros } from './pricing';

export const AGENT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type Effort = 'low' | 'medium' | 'high';

export interface LlmContext {
  organizationId: string;
  jobId: string | null;
  /** Logged to llm_calls.step, e.g. "triage". */
  step: string;
}

export interface StructuredRequest<T> {
  ctx: LlmContext;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  effort: Effort;
}

export interface ToolTurnRequest {
  ctx: LlmContext;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  effort: Effort;
}

/** The model declined (stop_reason "refusal") even after server-side fallback. */
export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`Model refused (${category ?? 'unknown'})`);
    this.name = 'LlmRefusalError';
  }
}

/** The model's answer was unusable (no parsable structured output, truncated, …). */
export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly stopReason: string | null,
  ) {
    super(message);
    this.name = 'LlmOutputError';
  }
}

/** Seam for tests: production uses ClaudeLlm, tests use a scripted fake. */
export interface LlmClient {
  structured<T>(req: StructuredRequest<T>): Promise<T>;
  toolTurn(req: ToolTurnRequest): Promise<Anthropic.Beta.BetaMessage>;
}

/**
 * Claude via the official SDK.
 * - Opus 5.5: thinking is always on (adaptive); depth is controlled with effort, set explicitly.
 * - Forced tool_choice is not supported on this model, so structured answers use output_config.
 * - Server-side refusal fallback is on ("default" routing).
 * - Top-level cache_control caches the stable prefix (system + tools). Prefixes below the model's
 *   minimum cacheable size simply don't cache — cache_read tokens in llm_calls show the effect.
 * - Every request writes an llm_calls row (tokens, cost, latency), success or failure.
 */
export class ClaudeLlm implements LlmClient {
  constructor(
    private readonly db: DbOrTx,
    private readonly client: Anthropic = new Anthropic(),
    private readonly model: string = AGENT_MODEL,
  ) {}

  structured<T>(req: StructuredRequest<T>): Promise<T> {
    return this.traced(req.ctx, req.effort, () => this.structuredCall(req));
  }

  toolTurn(req: ToolTurnRequest): Promise<Anthropic.Beta.BetaMessage> {
    return this.traced(req.ctx, req.effort, () => this.toolTurnCall(req));
  }

  /** One OpenTelemetry GenAI span per request (gen_ai.* semantic conventions; Langfuse reads these). */
  private traced<T>(ctx: LlmContext, effort: Effort, fn: () => Promise<T>): Promise<T> {
    return withSpan(
      `chat ${this.model}`,
      {
        'gen_ai.operation.name': 'chat',
        'gen_ai.system': 'anthropic',
        'gen_ai.request.model': this.model,
        'gen_ai.conversation.id': ctx.jobId ?? ctx.organizationId,
        'keyhook.step': ctx.step,
        'keyhook.effort': effort,
        'keyhook.organization_id': ctx.organizationId,
        ...(ctx.jobId ? { 'keyhook.job_id': ctx.jobId } : {}),
      },
      fn,
    );
  }

  private async structuredCall<T>(req: StructuredRequest<T>): Promise<T> {
    const started = Date.now();
    try {
      const { data, request_id } = await this.client.beta.messages
        .parse({
          model: this.model,
          max_tokens: 16_000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
        })
        .withResponse();
      await this.record(req.ctx, data, Date.now() - started, request_id ?? null);
      this.assertUsable(data);
      if (data.parsed_output === null) {
        throw new LlmOutputError('No parsable structured output', data.stop_reason);
      }
      return data.parsed_output;
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        await this.recordError(req.ctx, apiErrorInfo(err), Date.now() - started);
      }
      throw err;
    }
  }

  private async toolTurnCall(req: ToolTurnRequest): Promise<Anthropic.Beta.BetaMessage> {
    const started = Date.now();
    try {
      const { data, request_id } = await this.client.beta.messages
        .create({
          model: this.model,
          max_tokens: 16_000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          system: req.system,
          tools: req.tools,
          messages: req.messages,
          output_config: { effort: req.effort },
        })
        .withResponse();
      await this.record(req.ctx, data, Date.now() - started, request_id ?? null);
      this.assertUsable(data);
      return data;
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        await this.recordError(req.ctx, apiErrorInfo(err), Date.now() - started);
      }
      throw err;
    }
  }

  private assertUsable(msg: Anthropic.Beta.BetaMessage): void {
    if (msg.stop_reason === 'refusal') {
      throw new LlmRefusalError(msg.stop_details?.category ?? null);
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new LlmOutputError('Response truncated at max_tokens', msg.stop_reason);
    }
  }

  private async record(
    ctx: LlmContext,
    msg: Anthropic.Beta.BetaMessage,
    latencyMs: number,
    requestId: string | null,
  ): Promise<void> {
    const usage = {
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
    };
    const cost = costUsdMicros(msg.model, usage);
    trace.getActiveSpan()?.setAttributes({
      'gen_ai.response.model': msg.model,
      'gen_ai.response.id': msg.id,
      'gen_ai.response.finish_reasons': [msg.stop_reason ?? 'unknown'],
      'gen_ai.usage.input_tokens': usage.inputTokens,
      'gen_ai.usage.output_tokens': usage.outputTokens,
      'gen_ai.usage.cache_read_input_tokens': usage.cacheReadInputTokens,
      'gen_ai.usage.cache_creation_input_tokens': usage.cacheCreationInputTokens,
      ...(cost !== null ? { 'keyhook.cost_usd': cost / 1e6 } : {}),
      ...(requestId ? { 'anthropic.request_id': requestId } : {}),
    });
    await this.db.insert(llmCalls).values({
      organizationId: ctx.organizationId,
      jobId: ctx.jobId,
      step: ctx.step,
      requestedModel: this.model,
      servedModel: msg.model,
      stopReason: msg.stop_reason,
      ...usage,
      // Fallback rescues bill at the serving model's rates.
      costUsdMicros: cost,
      latencyMs,
      requestId,
    });
  }

  private async recordError(
    ctx: LlmContext,
    err: ReturnType<typeof apiErrorInfo>,
    latencyMs: number,
  ) {
    await this.db.insert(llmCalls).values({
      organizationId: ctx.organizationId,
      jobId: ctx.jobId,
      step: ctx.step,
      requestedModel: this.model,
      latencyMs,
      requestId: err.requestID ?? null,
      error: { status: err.status ?? null, type: err.name, message: err.message },
    });
  }
}

function apiErrorInfo(err: Error & { status?: unknown; requestID?: unknown }) {
  return {
    status: typeof err.status === 'number' ? err.status : undefined,
    requestID: typeof err.requestID === 'string' ? err.requestID : null,
    name: err.name,
    message: err.message,
  };
}
