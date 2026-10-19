import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { TRADIE } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { getJob } from '@/domain/jobs';
import { db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { advanceJob } from './advance';

/* Layer 1 of the intent funnel: fixed short replies are read by rules, with no model call. */

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

const noModel = () => {
  throw new Error('the model must not be called for this reply');
};

async function step(
  llm: ReturnType<typeof happyLlm>,
  from: 'tenant' | 'tradie',
  body: string,
  jobId?: string,
) {
  const m = await say(from, from === 'tenant' ? tenantId : TRADIE.capitalPlumbing, body, jobId);
  await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
  return m.jobId;
}

describe('rule-read replies', () => {
  it('books "option 2 please" and closes on "Yep, all fixed!" without interpret calls', async () => {
    const llm = happyLlm({ 'interpret.slot': noModel, 'interpret.confirmation': noModel });
    const jobId = await step(llm, 'tenant', 'No hot water');
    await step(llm, 'tradie', '$185 incl GST', jobId);
    await step(llm, 'tenant', 'option 2 please', jobId);
    expect((await getJob(db, org, jobId)).state).toBe('SCHEDULED');
    await step(llm, 'tradie', 'All done, thermocouple replaced', jobId);
    expect((await getJob(db, org, jobId)).state).toBe('AWAITING_CONFIRMATION');
    await step(llm, 'tenant', 'Yep, all fixed!', jobId);
    expect((await getJob(db, org, jobId)).state).toBe('CLOSED');

    const steps = llm.calls.map((c) => c.step);
    expect(steps).not.toContain('interpret.slot');
    expect(steps).not.toContain('interpret.confirmation');
    const rules = await db
      .select({ input: auditLog.input, output: auditLog.output })
      .from(auditLog)
      .where(and(eq(auditLog.jobId, jobId), eq(auditLog.action, 'intent.rule')));
    expect(rules.map((r) => r.output)).toEqual([{ chosenOption: 2 }, { confirmed: 'yes' }]);
  });

  it('sends anything beyond the fixed pattern to the model', async () => {
    const llm = happyLlm({
      'interpret.confirmation': () => ({
        confirmed: 'no',
        notes: 'still drips',
        promptInjection: false,
      }),
    });
    const jobId = await step(llm, 'tenant', 'No hot water');
    await step(llm, 'tradie', '$185 incl GST', jobId);
    await step(llm, 'tenant', 'Option 2 — the cat is inside, please close the door', jobId);
    await step(llm, 'tradie', 'All done, thermocouple replaced', jobId);
    await step(llm, 'tenant', "Yes but it's still dripping a bit", jobId);

    const steps = llm.calls.map((c) => c.step);
    expect(steps).toContain('interpret.slot');
    expect(steps).toContain('interpret.confirmation');
    expect((await getJob(db, org, jobId)).state).toBe('ESCALATED');
  });
});
