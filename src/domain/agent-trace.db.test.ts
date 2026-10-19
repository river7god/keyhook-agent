import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { llmCalls } from '@/db/schema';
import { seed } from '@/db/seed/seed';
import { ORG } from '@/db/seed/ids';
import { advanceJob } from '@/agent/advance';
import { db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { TOOL_NAMES } from '@/tools/registry';
import { getJobTrace } from './agent-trace';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

describe('getJobTrace', () => {
  it('merges model calls and tool calls in time order, with totals per job', async () => {
    const { jobId } = await say('tenant', tenantId, 'No hot water since this morning');
    await advanceJob(deps(happyLlm()), { organizationId: org, jobId });
    const at = (s: number) => new Date(now.getTime() + s * 1000);
    await db.insert(llmCalls).values([
      {
        organizationId: org,
        jobId,
        step: 'triage',
        requestedModel: 'anthropic:claude-opus-5-5',
        servedModel: 'anthropic:claude-opus-5-5',
        stopReason: 'end_turn',
        inputTokens: 2000,
        outputTokens: 300,
        cacheReadInputTokens: 1500,
        costUsdMicros: 12_000,
        latencyMs: 4200,
        createdAt: at(-60),
      },
      {
        organizationId: org,
        jobId,
        step: 'compose',
        requestedModel: 'moonshot:kimi-k2.6',
        latencyMs: 30_000,
        error: { message: 'Request timed out.' },
        createdAt: at(-30),
      },
      // Another organisation's call on a job id must never show up.
      {
        organizationId: ORG.aroValley,
        jobId: null,
        step: 'triage',
        requestedModel: 'x',
        latencyMs: 1,
      },
    ]);

    const { rows, totals, bySteps } = await getJobTrace(db, org, jobId, TOOL_NAMES);

    const models = rows.filter((r) => r.kind === 'model');
    expect(models.map((r) => r.step)).toEqual(['triage', 'compose']);
    expect(models[1]).toMatchObject({ outcome: 'error', note: 'Request timed out.' });
    expect(rows.some((r) => r.kind === 'tool' && r.name === 'send_message')).toBe(true);
    // Non-tool audit rows (state transitions, job.created) are not "calls".
    expect(rows.every((r) => r.kind === 'model' || TOOL_NAMES.has(r.name))).toBe(true);
    const times = rows.map((r) => r.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    expect(totals).toMatchObject({
      modelCalls: 2,
      failedModelCalls: 1,
      inputTokens: 2000,
      outputTokens: 300,
      cachedTokens: 1500,
      costUsdMicros: 12_000,
      unpricedCalls: 1,
      modelLatencyMs: 34_200,
    });
    expect(totals.toolCalls).toBeGreaterThan(0);
    expect(bySteps[0]?.step).toBe('compose');
  });
});
