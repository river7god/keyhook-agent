import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { llmCalls } from '@/db/schema';
import { ORG, TRADIE } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { getJob } from '@/domain/jobs';
import { cleanTriage, db, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { advanceJob } from '../advance';
import { LlmOutputError, LlmRefusalError } from '../llm';
import { RoutingLlm } from '.';
import { OpenAICompatibleLlm, toChatMessages } from './openai-compatible';
import { PROVIDERS } from './registry';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

type Body = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type Reply = {
  content?: string | null;
  tool_calls?: { id: string; name: string; arguments: string }[];
  finish?: string;
  refusal?: string;
};

/** Fake Chat Completions client: `respond` decides each reply from the request body. */
function fakeOpenAI(respond: (body: Body, n: number) => Reply) {
  const bodies: Body[] = [];
  const client = {
    chat: {
      completions: {
        create: (body: Body) => {
          bodies.push(body);
          const r = respond(body, bodies.length - 1);
          const data = {
            id: `chatcmpl_${bodies.length}`,
            model: body.model,
            choices: [
              {
                index: 0,
                finish_reason: r.finish ?? (r.tool_calls ? 'tool_calls' : 'stop'),
                message: {
                  role: 'assistant',
                  content: r.content ?? null,
                  refusal: r.refusal ?? null,
                  tool_calls: r.tool_calls?.map((t) => ({
                    id: t.id,
                    type: 'function',
                    function: { name: t.name, arguments: t.arguments },
                  })),
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          };
          return { withResponse: () => Promise.resolve({ data, request_id: 'req_oa' }) };
        },
      },
    },
  };
  return { client: client as unknown as OpenAI, bodies };
}

const ctx = { organizationId: ORG.harbourCity, jobId: null, step: 'interpret.test' };
const schema = z.object({ ok: z.boolean() });

describe('OpenAICompatibleLlm structured output', () => {
  it('uses JSON mode + schema-in-prompt for providers without JSON Schema, and records usage', async () => {
    const fake = fakeOpenAI(() => ({ content: '```json\n{"ok": true}\n```' }));
    const llm = new OpenAICompatibleLlm(db, PROVIDERS.deepseek, 'deepseek-chat', fake.client);
    await expect(
      llm.structured({ ctx, system: 'sys', user: 'u', schema, effort: 'low' }),
    ).resolves.toEqual({ ok: true });
    expect(fake.bodies[0]?.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(fake.bodies[0]?.messages[0])).toContain('JSON Schema');
    expect(fake.bodies[0]).toMatchObject({ max_tokens: 16_000 });
    expect(fake.bodies[0]).not.toHaveProperty('reasoning_effort');
    const [row] = await db.select().from(llmCalls).where(eq(llmCalls.step, 'interpret.test'));
    expect(row).toMatchObject({
      requestedModel: 'deepseek:deepseek-chat',
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it('uses native JSON Schema + reasoning_effort for OpenAI', async () => {
    const fake = fakeOpenAI(() => ({ content: '{"ok": false}' }));
    const llm = new OpenAICompatibleLlm(db, PROVIDERS.openai, 'gpt-test', fake.client);
    await llm.structured({ ctx, system: 'sys', user: 'u', schema, effort: 'medium' });
    expect(fake.bodies[0]?.response_format).toMatchObject({ type: 'json_schema' });
    expect(fake.bodies[0]).toMatchObject({
      reasoning_effort: 'medium',
      max_completion_tokens: 16_000,
    });
  });

  it('repairs once, then gives up', async () => {
    const once = fakeOpenAI((_b, n) => ({ content: n === 0 ? '{"ok":"yes"}' : '{"ok":true}' }));
    await expect(
      new OpenAICompatibleLlm(db, PROVIDERS.moonshot, 'kimi', once.client).structured({
        ctx,
        system: 's',
        user: 'u',
        schema,
        effort: 'low',
      }),
    ).resolves.toEqual({ ok: true });
    expect(once.bodies).toHaveLength(2);

    const never = fakeOpenAI(() => ({ content: 'not json' }));
    await expect(
      new OpenAICompatibleLlm(db, PROVIDERS.moonshot, 'kimi', never.client).structured({
        ctx,
        system: 's',
        user: 'u',
        schema,
        effort: 'low',
      }),
    ).rejects.toBeInstanceOf(LlmOutputError);
  });

  it('maps refusals and truncation to the shared errors', async () => {
    const refuse = fakeOpenAI(() => ({ refusal: 'I can’t help with that' }));
    await expect(
      new OpenAICompatibleLlm(db, PROVIDERS.openai, 'm', refuse.client).structured({
        ctx,
        system: 's',
        user: 'u',
        schema,
        effort: 'low',
      }),
    ).rejects.toBeInstanceOf(LlmRefusalError);
    const cut = fakeOpenAI(() => ({ content: '{"ok":', finish: 'length' }));
    await expect(
      new OpenAICompatibleLlm(db, PROVIDERS.openai, 'm', cut.client).structured({
        ctx,
        system: 's',
        user: 'u',
        schema,
        effort: 'low',
      }),
    ).rejects.toBeInstanceOf(LlmOutputError);
    expect(cut.bodies).toHaveLength(2); // retried once before giving up
  });

  it('retries a truncated answer once (reasoning models can run out of budget)', async () => {
    const flaky = fakeOpenAI((_b, n) =>
      n === 0 ? { content: '{"ok":', finish: 'length' } : { content: '{"ok":true}' },
    );
    await expect(
      new OpenAICompatibleLlm(db, PROVIDERS.openai, 'm', flaky.client).structured({
        ctx,
        system: 's',
        user: 'u',
        schema,
        effort: 'low',
      }),
    ).resolves.toEqual({ ok: true });
    expect(flaky.bodies).toHaveLength(2);
  });
});

describe('message translation', () => {
  it('converts Anthropic tool_use / tool_result / thinking to Chat Completions', () => {
    const messages = [
      { role: 'user', content: 'Arrange a quote' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'text', text: 'Searching' },
          { type: 'tool_use', id: 'call_1', name: 'search_tradies', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: '{"x":1}', is_error: false },
        ],
      },
    ] as unknown as Anthropic.Beta.BetaMessageParam[];
    expect(toChatMessages(messages)).toEqual([
      { role: 'user', content: 'Arrange a quote' },
      {
        role: 'assistant',
        content: 'Searching',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'search_tradies', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"x":1}' },
    ]);
  });
});

describe('a full job on a non-Claude provider', () => {
  it('triages and arranges a quote through the same handlers', async () => {
    const fake = fakeOpenAI((body) => {
      const system = JSON.stringify(body.messages[0]);
      if (body.tools) {
        const last = body.messages.at(-1);
        if (last?.role !== 'tool')
          return { tool_calls: [{ id: 'c1', name: 'search_tradies', arguments: '{}' }] };
        const ids = (
          JSON.parse(typeof last.content === 'string' ? last.content : '{}') as {
            selectableTradieIds: string[];
          }
        ).selectableTradieIds;
        return {
          tool_calls: [
            {
              id: 'c2',
              name: 'request_quote',
              arguments: JSON.stringify({
                tradieId: ids[0],
                scope: 'Repair hot water cylinder',
                messageToTradie: 'Hi, can you quote for a hot water repair in Newtown?',
                selectionReason: 'Policy top pick',
              }),
            },
          ],
        };
      }
      if (system.includes('Task: triage')) return { content: JSON.stringify(cleanTriage) };
      return { content: '{"body":"ok"}' };
    });
    const llm = new RoutingLlm(db, {
      default: { provider: 'deepseek', model: 'deepseek-chat' },
      steps: {},
      acknowledgeOffshoreProviders: true,
      syntheticDataOnly: true,
    });
    // Inject the fake into the lazily created client.
    (llm as unknown as { clients: Map<string, unknown> }).clients.set(
      'deepseek:deepseek-chat',
      new OpenAICompatibleLlm(db, PROVIDERS.deepseek, 'deepseek-chat', fake.client),
    );

    const m = await say('tenant', tenantId, 'No hot water');
    await advanceJob(
      { db, llm, now: () => now },
      { organizationId: org, jobId: m.jobId, messageId: m.messageId },
    );
    expect(await getJob(db, org, m.jobId)).toMatchObject({
      state: 'AWAITING_QUOTE',
      assignedTradieId: TRADIE.capitalPlumbing,
    });
  });
});

describe('RoutingLlm.resolve', () => {
  it('routes exact step → group → default, and honours an override', () => {
    const r = new RoutingLlm(db, {
      default: { provider: 'anthropic', model: 'claude-opus-5-5' },
      steps: { compose: { provider: 'openai', model: 'gpt-x' } },
      acknowledgeOffshoreProviders: false,
      syntheticDataOnly: false,
    });
    expect(r.resolve('compose.tenant')).toEqual({ provider: 'openai', model: 'gpt-x' });
    expect(r.resolve('triage')).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(new RoutingLlm(db, null).resolve('anything')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
    expect(
      new RoutingLlm(db, null, { provider: 'moonshot', model: 'k' }).resolve('triage'),
    ).toEqual({ provider: 'moonshot', model: 'k' });
  });
});
