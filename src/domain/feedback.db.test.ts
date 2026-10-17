import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { advanceJob } from '@/agent/advance';
import { handBackJob } from '@/agent/pm-actions';
import { withOrg } from '@/db/org-scope';
import { agentFeedback } from '@/db/schema';
import { ORG, PM } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { cleanTriage, db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { feedbackInputSchema, listFeedback, recordFeedback } from './feedback';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

async function escalatedEmergency() {
  const llm = happyLlm({
    triage: () => ({
      ...cleanTriage,
      urgency: 'emergency',
      flags: { ...cleanTriage.flags, emergencySignals: true },
    }),
  });
  const m = await say('tenant', tenantId, 'Water dripping near the switchboard');
  await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
  return m.jobId;
}

describe('agent feedback', () => {
  it('records a PM flag with what the agent decided at the time', async () => {
    const jobId = await escalatedEmergency();
    await recordFeedback(db, {
      organizationId: org,
      jobId,
      propertyManagerId: PM.aroha,
      input: {
        kind: 'urgency',
        expectedUrgency: 'urgent',
        expectedTrade: null,
        note: 'Only a slow drip, nowhere near the board',
      },
    });
    const [row] = await listFeedback(db, org);
    expect(row).toMatchObject({
      source: 'pm_flag',
      kind: 'urgency',
      expected: { urgency: 'urgent' },
      agentSaw: { urgency: 'emergency', escalate: true, state: 'ESCALATED' },
      pm: 'Aroha Ngata',
    });
  });

  it('requires the corrected value for urgency/trade and a note for "other"', () => {
    expect(
      feedbackInputSchema.safeParse({
        kind: 'urgency',
        expectedUrgency: null,
        expectedTrade: null,
        note: null,
      }).success,
    ).toBe(false);
    expect(
      feedbackInputSchema.safeParse({
        kind: 'other',
        expectedUrgency: null,
        expectedTrade: null,
        note: null,
      }).success,
    ).toBe(false);
    expect(
      feedbackInputSchema.safeParse({
        kind: 'should_not_have_escalated',
        expectedUrgency: null,
        expectedTrade: null,
        note: null,
      }).success,
    ).toBe(true);
  });

  it('turns a hand-back that changes urgency/trade into corrections automatically', async () => {
    const jobId = await escalatedEmergency();
    await handBackJob(db, {
      organizationId: org,
      jobId,
      propertyManagerId: PM.aroha,
      note: 'Not dangerous',
      urgency: 'urgent',
      trade: 'plumbing',
      now,
    });
    const rows = await listFeedback(db, org);
    // trade was already plumbing → only the urgency correction is recorded
    expect(rows.map((r) => [r.source, r.kind, r.expected])).toEqual([
      ['hand_back_override', 'urgency', { urgency: 'urgent' }],
    ]);
  });

  it('is isolated per organization under RLS', async () => {
    const jobId = await escalatedEmergency();
    await recordFeedback(db, {
      organizationId: org,
      jobId,
      propertyManagerId: PM.aroha,
      input: {
        kind: 'should_not_have_escalated',
        expectedUrgency: null,
        expectedTrade: null,
        note: null,
      },
    });
    const other = await withOrg(db, ORG.aroValley, (tx) => tx.select().from(agentFeedback));
    expect(other).toHaveLength(0);
  });
});
