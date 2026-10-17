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
import { ClaudeLlm, LlmOutputError, LlmRefusalError } from './llm';

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

/** Minimal stand-in for the SDK client: returns a canned message from parse/create. */
function fakeClient(message: Partial<Anthropic.Beta.BetaMessage> & { parsed_output?: unknown }) {
  const full = {
    id: 'msg_test',
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
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
  const respond = () => ({
    withResponse: () => Promise.resolve({ data: full, request_id: 'req_123' }),
  });
  return { beta: { messages: { parse: respond, create: respond } } } as unknown as Anthropic;
}

const req = {
  ctx: { organizationId: ORG.harbourCity, jobId: null, step: 'test.step' },
  system: 'sys',
  user: 'hi',
  schema: z.object({ ok: z.boolean() }),
  effort: 'low' as const,
};

describe('ClaudeLlm', () => {
  it('returns parsed output, records usage/cost, and emits a GenAI span', async () => {
    const llm = new ClaudeLlm(db, fakeClient({ parsed_output: { ok: true } }));
    await expect(llm.structured(req)).resolves.toEqual({ ok: true });

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
        parsed_output: null,
      }),
    );
    await expect(llm.structured(req)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(await db.select().from(llmCalls)).toHaveLength(1);
  });

  it('raises LlmOutputError when there is no parsable output', async () => {
    const llm = new ClaudeLlm(db, fakeClient({ parsed_output: null }));
    await expect(llm.structured(req)).rejects.toBeInstanceOf(LlmOutputError);
  });
});
