import AnthropicClient from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { llmCalls } from '@/db/schema';
import { ORG } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { closeTestDb, testDb } from '@/test/db';
import { ClaudeLlm, LlmConfigError, LlmOutputError, LlmRefusalError } from './llm';

const db = testDb();
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  provider.register();
});
beforeEach(async () => {
  await seed(db);
  exporter.reset();
});
afterAll(async () => {
  await provider.shutdown();
  await closeTestDb();
});

/**
 * The real SDK client over a fake HTTP layer, so the test exercises what the SDK actually returns
 * at runtime (a hand-written stand-in once hid that `parse()` has no `.withResponse()`).
 */
function fakeClient(
  message: Partial<Anthropic.Beta.BetaMessage>,
  opts: { status?: number; seen?: { url: string; headers: Headers; body: unknown }[] } = {},
) {
  const full = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    content: [],
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 0,
    },
    ...message,
  };
  const status = opts.status ?? 200;
  return new AnthropicClient({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: (url: string | URL | Request, init?: RequestInit) => {
      opts.seen?.push({
        url: url instanceof Request ? url.url : url.toString(),
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown,
      });
      const body =
        status === 200
          ? full
          : {
              type: 'error',
              error: { type: 'authentication_error', message: 'invalid x-api-key' },
            };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', 'request-id': 'req_123' },
        }),
      );
    },
  });
}

const json = (v: unknown) => [{ type: 'text', text: JSON.stringify(v), citations: null }] as never;

const req = {
  ctx: { organizationId: ORG.harbourCity, jobId: null, step: 'test.step' },
  system: 'sys',
  user: 'hi',
  schema: z.object({ ok: z.boolean() }),
  effort: 'low' as const,
};

describe('ClaudeLlm', () => {
  it('returns parsed output, records usage/cost, and emits a GenAI span', async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = [];
    const llm = new ClaudeLlm(db, fakeClient({ content: json({ ok: true }) }, { seen }));
    await expect(llm.structured(req)).resolves.toEqual({ ok: true });
    expect(seen[0]?.url).toContain('/v1/messages');
    expect(seen[0]?.headers.get('anthropic-beta')).toContain('structured-outputs-2025-12-15');
    expect(seen[0]?.body).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });

    const [row] = await db.select().from(llmCalls).where(eq(llmCalls.step, 'test.step'));
    // 1000×4 + 200×20 + 500×0.2 = 8,100 µ$
    expect(row).toMatchObject({
      inputTokens: 1000,
      outputTokens: 200,
      costUsdMicros: 8_100,
      requestId: 'req_123',
    });

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe('chat claude-opus-5-5');
    expect(span?.attributes).toMatchObject({
      'gen_ai.system': 'anthropic',
      'gen_ai.usage.input_tokens': 1000,
      'gen_ai.usage.output_tokens': 200,
      'keyhook.step': 'test.step',
      'keyhook.effort': 'low',
    });
  });

  it('raises LlmRefusalError on a refusal and still records the call', async () => {
    const llm = new ClaudeLlm(
      db,
      fakeClient({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: null } as never,
      }),
    );
    await expect(llm.structured(req)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(await db.select().from(llmCalls)).toHaveLength(1);
  });

  it('raises LlmOutputError when there is no output or it does not match the schema', async () => {
    await expect(new ClaudeLlm(db, fakeClient({})).structured(req)).rejects.toBeInstanceOf(
      LlmOutputError,
    );
    await expect(
      new ClaudeLlm(db, fakeClient({ content: json({ ok: 'yes' }) })).structured(req),
    ).rejects.toBeInstanceOf(LlmOutputError);
  });

  it('turns an auth failure into LlmConfigError (escalate, no retries)', async () => {
    const llm = new ClaudeLlm(db, fakeClient({}, { status: 401 }));
    await expect(llm.structured(req)).rejects.toBeInstanceOf(LlmConfigError);
  });

  it('runs a tool turn through the real SDK', async () => {
    const llm = new ClaudeLlm(
      db,
      fakeClient({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'search_tradies', input: {} }] as never,
      }),
    );
    const msg = await llm.toolTurn({
      ctx: req.ctx,
      system: 'sys',
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      effort: 'low',
    });
    expect(msg.content[0]).toMatchObject({ type: 'tool_use', name: 'search_tradies' });
  });
});
