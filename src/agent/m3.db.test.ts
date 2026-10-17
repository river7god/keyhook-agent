import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { messages, tradieAvailability } from '@/db/schema';
import { PM, TRADIE } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { listDashboardJobs, stateCounts } from '@/domain/dashboard';
import { getJob } from '@/domain/jobs';
import { getJobTimeline } from '@/domain/timeline';
import { cleanTriage, db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { advanceJob } from './advance';
import { cancelJob, handBackJob, pmSendMessage } from './pm-actions';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

const emergencyLlm = () =>
  happyLlm({
    triage: () => ({
      ...cleanTriage,
      urgency: 'emergency',
      flags: { ...cleanTriage.flags, emergencySignals: true },
    }),
  });

async function escalatedAtTriage() {
  const llm = emergencyLlm();
  const m = await say('tenant', tenantId, 'I can smell gas near the hot water cylinder');
  await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
  return getJob(db, org, m.jobId);
}

describe('hand back', () => {
  it('resumes a triage escalation without re-triaging, using the PM-confirmed triage', async () => {
    const job = await escalatedAtTriage();
    expect(job.state).toBe('ESCALATED');

    const r = await handBackJob(db, {
      organizationId: org,
      jobId: job.id,
      propertyManagerId: PM.aroha,
      note: 'Gas company made it safe; needs a plumber for the cylinder',
      urgency: 'urgent',
      trade: 'plumbing',
      now,
    });
    expect(r.state).toBe('RECEIVED');

    // The same triage script would escalate again — it must not be called.
    const llm = emergencyLlm();
    const adv = await advanceJob(deps(llm), { organizationId: org, jobId: job.id });
    expect(adv.handled).toEqual(['triage', 'arrange_quote']);
    expect(llm.calls.map((c) => c.step)).not.toContain('triage');
    expect(await getJob(db, org, job.id)).toMatchObject({
      state: 'AWAITING_QUOTE',
      urgency: 'urgent',
    });
  });

  it('refuses to hand back a job that is not escalated', async () => {
    const m = await say('tenant', tenantId, 'No hot water');
    await expect(
      handBackJob(db, {
        organizationId: org,
        jobId: m.jobId,
        propertyManagerId: PM.aroha,
        note: null,
        now,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('rejects an unknown or other-organization PM', async () => {
    const job = await escalatedAtTriage();
    await expect(
      handBackJob(db, {
        organizationId: org,
        jobId: job.id,
        propertyManagerId: PM.mere,
        note: null,
        now,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('cancel', () => {
  it('cancels as the PM and frees the booked slot', async () => {
    const llm = happyLlm();
    const m = await say('tenant', tenantId, 'No hot water');
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    for (const [who, id, body] of [
      ['tradie', TRADIE.capitalPlumbing, '$185 incl GST'],
      ['tenant', tenantId, 'Option 1'],
    ] as const) {
      const r = await say(who, id, body, m.jobId);
      await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: r.messageId });
    }
    expect((await getJob(db, org, m.jobId)).state).toBe('SCHEDULED');

    await cancelJob(db, {
      organizationId: org,
      jobId: m.jobId,
      propertyManagerId: PM.aroha,
      reason: 'Tenant fixed it',
    });
    expect((await getJob(db, org, m.jobId)).state).toBe('CANCELLED');
    const booked = await db
      .select()
      .from(tradieAvailability)
      .where(eq(tradieAvailability.bookedJobId, m.jobId));
    expect(booked).toHaveLength(0);
  });
});

describe('PM messages', () => {
  it('sends once per client request id and records the PM as sender', async () => {
    const m = await say('tenant', tenantId, 'No hot water');
    const args = {
      organizationId: org,
      jobId: m.jobId,
      propertyManagerId: PM.aroha,
      recipient: 'tenant' as const,
      body: 'Hi Ana, I am looking into this personally.',
      clientRequestId: '6f1c1f9e-6a49-4a8e-9d4f-1d2b6c7e8f90',
    };
    await pmSendMessage(db, args);
    await pmSendMessage(db, args);
    const sent = await db
      .select()
      .from(messages)
      .where(and(eq(messages.jobId, m.jobId), eq(messages.senderType, 'pm')));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ senderId: PM.aroha, status: 'sent' });
  });
});

describe('dashboard queries', () => {
  it('puts escalated jobs in the PM queue with the reason and recommendation', async () => {
    const job = await escalatedAtTriage();
    const counts = await stateCounts(db, org);
    expect(counts.needs_pm).toBe(1);
    const queue = await listDashboardJobs(db, org, { bucket: 'needs_pm' });
    expect(queue.map((j) => j.id)).toEqual([job.id]);
    expect(queue[0]?.escalationReason).toContain('emergency');
    expect(queue[0]?.recommendation).toContain('Call the tenant');
    // seed history (3 closed + 1 cancelled) is "done"
    expect(counts.done).toBe(4);
  });

  it('builds a timeline with messages, triage, transitions and an escalation linked to evidence', async () => {
    const job = await escalatedAtTriage();
    const { items } = await getJobTimeline(db, org, job.id);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['message', 'triage', 'transition', 'escalation']),
    );
    const esc = items.find((i) => i.kind === 'escalation');
    const inbound = items.find((i) => i.kind === 'message' && i.direction === 'inbound');
    expect(esc?.kind === 'escalation' && esc.evidenceMessageIds).toContain(inbound?.id);
    const times = items.map((i) => i.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
