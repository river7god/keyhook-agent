import { afterAll, describe, expect, it } from 'vitest';
import { cleanTriage, happyLlm } from '@/test/agent-fixtures';
import { closeTestDb, testDb } from '@/test/db';
import { loadScenarios, runScenario } from './run';

/** Exercises the runner's step mechanics with the scripted LLM — no API calls. */
const db = testDb();
const byId = (id: string) => {
  const s = loadScenarios().find((x) => x.id === id);
  if (!s) throw new Error(`missing scenario ${id}`);
  return s;
};

afterAll(async () => {
  await closeTestDb();
});

describe('eval runner', () => {
  it('runs a full multi-actor scenario and scores it', async () => {
    const r = await runScenario(db, byId('happy-path-full-close'), happyLlm());
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ state: 'CLOSED', forbiddenHits: [], missingActions: [] });
    expect(Object.values(r.checks).every(Boolean)).toBe(true);
  });

  it('drives PM approval steps', async () => {
    const llm = happyLlm({
      'interpret.quote': () => ({
        kind: 'quote',
        amountNzd: '640',
        gst: 'excluded',
        notes: '',
        promptInjection: false,
      }),
    });
    const r = await runScenario(db, byId('over-budget-approved'), llm);
    expect(r.error).toBeUndefined();
    expect(r.checks).toEqual({ state: true, estimate: true, actions: true });
  });

  it('advances simulated time through follow-ups', async () => {
    const r = await runScenario(db, byId('tradie-unresponsive-reassign'), happyLlm());
    expect(r.error).toBeUndefined();
    expect(r.checks).toEqual({ state: true, actions: true });
  });

  // The waits in time-based scenarios must actually reach each follow-up (urgency-specific
  // timings + quiet hours). Checked here with model behaviour fixed, so a live failure means
  // the model, not the scenario's clock maths.
  it.each([
    [
      'unresponsive-no-alternative-locksmith',
      { triage: () => ({ ...cleanTriage, urgency: 'routine', trade: 'locksmith' }) },
    ],
    ['tenant-never-picks-slot', {}],
    ['confirmation-timeout', {}],
    [
      'clarify-no-reply',
      {
        triage: () => ({
          ...cleanTriage,
          needsMoreInfo: true,
          missingInfo: ['what'],
          tenantReply: 'What exactly?',
        }),
      },
    ],
  ] as const)('time-based scenario %s reaches its expected state', async (id, overrides) => {
    const r = await runScenario(db, byId(id), happyLlm(overrides));
    expect(r.error).toBeUndefined();
    expect(r.checks.state).toBe(true);
  });

  it('stops early (not an error) when the agent escalates sooner than the script expects', async () => {
    const llm = happyLlm({
      triage: () => ({ ...cleanTriage, flags: { ...cleanTriage.flags, promptInjection: true } }),
    });
    const r = await runScenario(db, byId('injection-hidden-limit'), llm);
    expect(r.error).toBeUndefined();
    expect(r.stoppedEarly).toBe('ESCALATED before step 2/2');
    expect(r.checks.state).toBe(true);
    expect(r.forbiddenHits).toEqual([]);
  });

  it('reports a scenario error instead of throwing', async () => {
    const r = await runScenario(
      db,
      { ...byId('happy-path-full-close'), steps: [{ pm: 'approve' }] },
      happyLlm(),
    );
    expect(r.error).toContain('pm step before a job exists');
  });
});
