import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { llmCalls, messages } from '@/db/schema';
import { ORG } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { latestAuditOutput } from '@/domain/audit';
import { usageReport } from '@/domain/usage';
import { db, now, org, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { ScriptedLlm } from '@/test/fake-llm';
import { runOpsAnalysis } from './analyst';
import { detectInsights } from './insights';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);

async function seedUsage() {
  const call = (step: string, model: string, latencyMs: number, extra = {}) => ({
    organizationId: org,
    step,
    requestedModel: model,
    servedModel: model,
    latencyMs,
    inputTokens: 1800,
    outputTokens: 400,
    cacheReadInputTokens: 0,
    costUsdMicros: model === 'claude-opus-5-5' ? 15_200 : null,
    createdAt: ago(5),
    ...extra,
  });
  await db.insert(llmCalls).values([
    // compose on Opus: 12 calls, slow-ish, no cache → cheaper-model + cache findings
    ...Array.from({ length: 12 }, (_, i) => call('compose.tenant', 'claude-opus-5-5', 4000 + i)),
    // interpret on Kimi: unpriced, close to its 90 s limit, 2 of 10 failed
    ...Array.from({ length: 10 }, (_, i) =>
      call(
        'interpret.slot',
        'moonshot:kimi-k2.6',
        70_000,
        i < 2 ? { error: { message: 'timeout' } } : {},
      ),
    ),
    // another organisation's calls never count
    { ...call('compose.tenant', 'claude-opus-5-5', 1), organizationId: ORG.aroValley },
    // older than the window
    { ...call('compose.tenant', 'claude-opus-5-5', 1), createdAt: ago(24 * 40) },
  ]);
  await db.insert(messages).values(
    ['ok cool', 'ok cool', 'Option 2', 'option 2'].map((body) => ({
      organizationId: org,
      direction: 'inbound' as const,
      channel: 'simulator' as const,
      senderType: 'tenant' as const,
      senderId: tenantId,
      recipientType: 'agent' as const,
      body,
      status: 'received' as const,
      createdAt: ago(3),
    })),
  );
}

describe('usage report and findings', () => {
  it('aggregates by step and model for this org and window only', async () => {
    await seedUsage();
    const r = await usageReport(db, org, now);
    const compose = r.steps.find((s) => s.group === 'compose');
    expect(compose).toMatchObject({ model: 'claude-opus-5-5', calls: 12, errors: 0 });
    expect(r.totals.calls).toBe(22);
    expect(r.repeatedShortReplies).toEqual(
      expect.arrayContaining([
        { text: 'ok cool', count: 2 },
        { text: 'option 2', count: 2 },
      ]),
    );

    const ids = detectInsights(r).map((i) => i.id);
    expect(ids).toContain('cheaper-model:compose:claude-opus-5-5');
    expect(ids).toContain('cache:compose:claude-opus-5-5');
    expect(ids).toContain('timeout-risk:interpret:moonshot:kimi-k2.6');
    expect(ids).toContain('errors:interpret:moonshot:kimi-k2.6');
    expect(ids).toContain('unpriced');
    // "option 2" is already a layer-1 rule; "ok cool" is a candidate.
    const rules = detectInsights(r).find((i) => i.id === 'rule-candidates');
    expect(rules?.evidence).toContain('ok cool');
    expect(rules?.evidence).not.toContain('option 2');
    const saving = detectInsights(r).find((i) => i.id.startsWith('cheaper-model'));
    expect(saving?.savingUsdPer30Days).toBeGreaterThan(0);
  });
});

describe('Ops analyst', () => {
  it('ranks only detected findings, keeps tenant text out of the prompt, and audits the brief', async () => {
    await seedUsage();
    let prompt = '';
    const llm = new ScriptedLlm({
      'ops.analysis': (req: { user: string }) => {
        prompt = req.user;
        return {
          headline: 'Kimi interpret is timing out.',
          priorities: [
            {
              insightId: 'errors:interpret:moonshot:kimi-k2.6',
              why: '20 % failed',
              nextStep: 'Set a fallback',
            },
            { insightId: 'made-up', why: 'invented', nextStep: 'nothing' },
          ],
        };
      },
    });
    const a = await runOpsAnalysis({ db, llm, now: () => now }, org);

    expect(a.brief?.priorities.map((p) => p.insightId)).toEqual([
      'errors:interpret:moonshot:kimi-k2.6',
    ]);
    expect(prompt).not.toContain('ok cool');
    const stored = await latestAuditOutput(db, org, 'ops.analysis');
    expect(stored?.output).toMatchObject({ brief: { headline: 'Kimi interpret is timing out.' } });
  });

  it('makes no model call when there is nothing to report', async () => {
    const llm = new ScriptedLlm({});
    const a = await runOpsAnalysis({ db, llm, now: () => now }, org);
    expect(a.brief).toBeNull();
    expect(llm.calls).toHaveLength(0);
  });
});
