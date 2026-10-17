import type Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { llmCalls } from '@/db/schema';
import { withSpan } from '@/lib/telemetry';
import {
  isPermanentProviderError,
  LlmConfigError,
  LlmOutputError,
  LlmRefusalError,
  type Effort,
  type LlmClient,
  type LlmContext,
  type StructuredRequest,
  type ToolTurnRequest,
} from '../llm';
import { costUsdMicros } from '../pricing';
import type { ProviderInfo } from './registry';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatResponse = OpenAI.Chat.Completions.ChatCompletion;

/**
 * Any OpenAI Chat Completions–compatible provider (OpenAI, DeepSeek, Moonshot Kimi, …).
 * The agent's handlers speak the Anthropic message shape; this adapter translates both ways so
 * handler code is provider-agnostic. Structured output: native JSON Schema where supported,
 * otherwise JSON mode + schema in the prompt; always validated with Zod, one repair attempt.
 */
export class OpenAICompatibleLlm implements LlmClient {
  private readonly client: OpenAI;

  constructor(
    private readonly db: DbOrTx,
    private readonly provider: ProviderInfo,
    private readonly model: string,
    client?: OpenAI,
  ) {
    if (client) {
      this.client = client;
    } else {
      const apiKey = process.env[provider.apiKeyEnv];
      if (!apiKey)
        throw new LlmConfigError(`${provider.apiKeyEnv} is not set (provider ${provider.id})`);
      const baseURL =
        (provider.baseUrlEnv && process.env[provider.baseUrlEnv]) || provider.defaultBaseUrl;
      this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 2 });
    }
  }

  private get ref() {
    return `${this.provider.id}:${this.model}`;
  }

  structured<T>(req: StructuredRequest<T>): Promise<T> {
    if (req.images?.length && !this.provider.vision) {
      return Promise.reject(
        new LlmConfigError(
          `${this.ref} has no image input; route the "vision" step to a vision model`,
        ),
      );
    }
    return this.traced(req.ctx, req.effort, async () => {
      const schema = z.toJSONSchema(req.schema, { io: 'output' }) as Record<string, unknown>;
      delete schema.$schema;
      const system = this.provider.jsonSchemaOutput
        ? req.system
        : `${req.system}\n\nRespond with only a JSON object (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(schema)}`;
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        {
          role: 'user',
          content: req.images?.length
            ? [
                ...req.images.map((img) => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:${img.mediaType};base64,${img.data}` },
                })),
                { type: 'text' as const, text: req.user },
              ]
            : req.user,
        },
      ];
      const responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format'] =
        this.provider.jsonSchemaOutput
          ? { type: 'json_schema', json_schema: { name: 'output', schema, strict: false } }
          : { type: 'json_object' };

      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await this.call(req.ctx, req.effort, {
          messages,
          response_format: responseFormat,
        });
        const msg = this.firstMessage(res);
        const text = msg.content ?? '';
        let parsed: unknown;
        try {
          parsed = JSON.parse(stripFences(text));
        } catch {
          parsed = undefined;
        }
        const result = req.schema.safeParse(parsed);
        if (result.success) return result.data;
        messages.push(
          { role: 'assistant', content: text },
          {
            role: 'user',
            content: `That did not match the required schema: ${z.prettifyError(result.error)}. Reply with the corrected JSON object only.`,
          },
        );
      }
      throw new LlmOutputError(
        `${this.ref}: output did not match the schema after a repair attempt`,
        'invalid_json',
      );
    });
  }

  toolTurn(req: ToolTurnRequest): Promise<Anthropic.Beta.BetaMessage> {
    return this.traced(req.ctx, req.effort, async () => {
      const res = await this.call(req.ctx, req.effort, {
        messages: [{ role: 'system', content: req.system }, ...toChatMessages(req.messages)],
        tools: req.tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description ?? '',
            parameters: t.input_schema,
          },
        })),
        tool_choice: 'auto',
      });
      return toAnthropicMessage(this.firstMessage(res), res, this.ref);
    });
  }

  private async call(
    ctx: LlmContext,
    effort: Effort,
    body: Pick<
      OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      'messages' | 'tools' | 'tool_choice' | 'response_format'
    >,
  ): Promise<ChatResponse> {
    const started = Date.now();
    const limit = { [this.provider.maxTokensParam]: 16_000 };
    try {
      const { data, request_id } = await this.client.chat.completions
        .create({
          model: this.model,
          ...body,
          ...limit,
          ...(this.provider.reasoningEffort ? { reasoning_effort: effort } : {}),
        })
        .withResponse();
      await this.record(ctx, data, Date.now() - started, request_id ?? null);
      return data;
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        await this.db.insert(llmCalls).values({
          organizationId: ctx.organizationId,
          jobId: ctx.jobId,
          step: ctx.step,
          requestedModel: this.ref,
          latencyMs: Date.now() - started,
          requestId: typeof err.requestID === 'string' ? err.requestID : null,
          error: {
            status: typeof err.status === 'number' ? err.status : null,
            type: err.name,
            message: err.message,
          },
        });
        const status = typeof err.status === 'number' ? err.status : undefined;
        if (isPermanentProviderError(status, err.message)) {
          throw new LlmConfigError(`${this.ref} ${String(status)}: ${err.message}`);
        }
      }
      throw err;
    }
  }

  /** Refusals and truncation map to the same errors as the Claude client. */
  private firstMessage(res: ChatResponse): OpenAI.Chat.Completions.ChatCompletionMessage {
    const choice = res.choices[0];
    if (!choice) throw new LlmOutputError(`${this.ref}: no choices returned`, null);
    if (choice.message.refusal || choice.finish_reason === 'content_filter') {
      throw new LlmRefusalError(choice.message.refusal ? 'refusal' : 'content_filter');
    }
    if (choice.finish_reason === 'length')
      throw new LlmOutputError(`${this.ref}: truncated`, 'max_tokens');
    return choice.message;
  }

  private async record(
    ctx: LlmContext,
    res: ChatResponse,
    latencyMs: number,
    requestId: string | null,
  ) {
    const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const usage = {
      inputTokens: (res.usage?.prompt_tokens ?? 0) - cached,
      outputTokens: res.usage?.completion_tokens ?? 0,
      cacheReadInputTokens: cached,
      cacheCreationInputTokens: 0,
    };
    const cost = costUsdMicros(`${this.provider.id}:${res.model || this.model}`, usage);
    trace.getActiveSpan()?.setAttributes({
      'gen_ai.response.model': res.model,
      'gen_ai.response.id': res.id,
      'gen_ai.response.finish_reasons': res.choices.map((c) => c.finish_reason),
      'gen_ai.usage.input_tokens': usage.inputTokens + cached,
      'gen_ai.usage.output_tokens': usage.outputTokens,
      ...(cost !== null ? { 'keyhook.cost_usd': cost / 1e6 } : {}),
    });
    await this.db.insert(llmCalls).values({
      organizationId: ctx.organizationId,
      jobId: ctx.jobId,
      step: ctx.step,
      requestedModel: this.ref,
      servedModel: `${this.provider.id}:${res.model || this.model}`,
      stopReason: res.choices[0]?.finish_reason ?? null,
      ...usage,
      costUsdMicros: cost,
      latencyMs,
      requestId,
    });
  }

  private traced<T>(ctx: LlmContext, effort: Effort, fn: () => Promise<T>): Promise<T> {
    return withSpan(
      `chat ${this.model}`,
      {
        'gen_ai.operation.name': 'chat',
        'gen_ai.system': this.provider.id,
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
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
}

/** Anthropic-shaped conversation → Chat Completions messages. Thinking blocks are dropped. */
export function toChatMessages(messages: Anthropic.Beta.BetaMessageParam[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
      const toolCalls = m.content.flatMap((b) =>
        b.type === 'tool_use'
          ? [
              {
                id: b.id,
                type: 'function' as const,
                function: { name: b.name, arguments: JSON.stringify(b.input) },
              },
            ]
          : [],
      );
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const content =
          typeof b.content === 'string'
            ? b.content
            : (b.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
        out.push({
          role: 'tool',
          tool_call_id: b.tool_use_id,
          content: b.is_error ? `ERROR: ${content}` : content,
        });
      } else if (b.type === 'text') {
        out.push({ role: 'user', content: b.text });
      }
    }
  }
  return out;
}

/** Chat Completions reply → the Anthropic message shape handlers consume. */
export function toAnthropicMessage(
  msg: OpenAI.Chat.Completions.ChatCompletionMessage,
  res: ChatResponse,
  ref: string,
): Anthropic.Beta.BetaMessage {
  const content: unknown[] = [];
  if (msg.content) content.push({ type: 'text', text: msg.content, citations: null });
  for (const call of msg.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments || '{}');
    } catch {
      input = { __invalid_json__: call.function.arguments }; // fails Zod validation → error to the model
    }
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
  }
  const finish = res.choices[0]?.finish_reason;
  return {
    id: res.id,
    type: 'message',
    role: 'assistant',
    model: ref,
    content,
    stop_reason:
      finish === 'tool_calls' || (msg.tool_calls?.length ?? 0) > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    },
  } as unknown as Anthropic.Beta.BetaMessage;
}
