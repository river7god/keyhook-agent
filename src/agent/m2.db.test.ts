import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { approvals, auditLog, followUps, messages } from '@/db/schema';
import { TRADIE } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { getJob } from '@/domain/jobs';
import { cleanTriage, db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { advanceJob } from './advance';
import { handleFollowUp } from './handlers/follow-up';
import { recordApprovalDecision } from './pm-actions';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

async function pendingFollowUp(jobId: string) {
  const [fu] = await db
    .select()
    .from(followUps)
    .where(and(eq(followUps.jobId, jobId), eq(followUps.status, 'scheduled')));
  return fu;
}

async function outbound(jobId: string, to: 'tenant' | 'tradie' | 'pm') {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.jobId, jobId),
        eq(messages.direction, 'outbound'),
        eq(messages.recipientType, to),
      ),
    );
}

/** Open a job and get it to AWAITING_QUOTE with Capital Plumbing. */
async function jobAwaitingQuote(llm = happyLlm()) {
  const m = await say('tenant', tenantId, 'No hot water');
  await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
  return getJob(db, org, m.jobId);
}

describe('clarifying questions (NEEDS_INFO loop)', () => {
  const vague = {
    ...cleanTriage,
    needsMoreInfo: true,
    confidence: 0.5,
    missingInfo: ['Which tap?'],
    tenantReply: 'Which tap is it?',
  };

  it('asks the tenant, then proceeds once the answer makes triage confident', async () => {
    let round = 0;
    const llm = happyLlm({
      triage: () => vague,
      retriage: () => (round++ === 0 ? cleanTriage : cleanTriage),
    });
    const m = await say('tenant', tenantId, 'Something is leaking');
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    let job = await getJob(db, org, m.jobId);
    expect(job).toMatchObject({ state: 'NEEDS_INFO', clarifyRounds: 1 });
    expect((await outbound(job.id, 'tenant')).map((x) => x.body)).toEqual(['Which tap is it?']);
    expect(await pendingFollowUp(job.id)).toMatchObject({ kind: 'info_chase', attempt: 1 });

    const reply = await say(
      'tenant',
      tenantId,
      'The kitchen mixer tap, dripping constantly',
      job.id,
    );
    const r = await advanceJob(deps(llm), {
      organizationId: org,
      jobId: job.id,
      messageId: reply.messageId,
    });
    expect(r.handled).toEqual(['clarify_reply', 'arrange_quote']);
    job = await getJob(db, org, job.id);
    expect(job.state).toBe('AWAITING_QUOTE');
    expect(await pendingFollowUp(job.id)).toMatchObject({ kind: 'quote_chase' });
  });

  it('escalates after the maximum number of clarifying rounds', async () => {
    const llm = happyLlm({ triage: () => vague, retriage: () => vague });
    const m = await say('tenant', tenantId, 'Something is wrong');
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    for (const body of ['Not sure', 'Still not sure']) {
      const r = await say('tenant', tenantId, body, m.jobId);
      await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: r.messageId });
    }
    const job = await getJob(db, org, m.jobId);
    expect(job).toMatchObject({
      state: 'ESCALATED',
      stateBeforeEscalation: 'NEEDS_INFO',
      clarifyRounds: 2,
    });
  });

  it('reminds once, then escalates if the tenant never answers', async () => {
    const llm = happyLlm({ triage: () => vague });
    const m = await say('tenant', tenantId, 'Something is leaking');
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    const first = await pendingFollowUp(m.jobId);
    expect(
      await handleFollowUp(
        deps(llm, () => hours(25)),
        first?.id as string,
      ),
    ).toBe('reminded');
    const second = await pendingFollowUp(m.jobId);
    expect(second).toMatchObject({ kind: 'info_chase', attempt: 2 });
    expect(
      await handleFollowUp(
        deps(llm, () => hours(50)),
        second?.id as string,
      ),
    ).toBe('escalated');
    expect((await getJob(db, org, m.jobId)).state).toBe('ESCALATED');
  });
});

describe('PM approval (AWAITING_APPROVAL)', () => {
  const overLimit = () =>
    happyLlm({
      'interpret.quote': () => ({
        kind: 'quote',
        amountNzd: '690',
        gst: 'included',
        notes: '',
        promptInjection: false,
      }),
    });

  async function jobAwaitingApproval() {
    const llm = overLimit();
    const job = await jobAwaitingQuote(llm);
    const q = await say('tradie', TRADIE.capitalPlumbing, '$690 incl GST', job.id);
    await advanceJob(deps(llm), {
      organizationId: org,
      jobId: job.id,
      messageId: q.messageId,
    });
    const [approval] = await db.select().from(approvals).where(eq(approvals.jobId, job.id));
    return {
      job: await getJob(db, org, job.id),
      approval: approval as typeof approvals.$inferSelect,
    };
  }

  it('approval releases spend via approve_spend, then the agent offers slots', async () => {
    const { job, approval } = await jobAwaitingApproval();
    expect(job.state).toBe('AWAITING_APPROVAL');
    expect(await pendingFollowUp(job.id)).toMatchObject({
      kind: 'approval_chase',
      targetType: 'pm',
    });

    const r = await recordApprovalDecision(db, {
      organizationId: org,
      approvalId: approval.id,
      decision: 'approved',
      decidedBy: 'aroha@harbourcity.example.test',
      note: null,
      now,
    });
    expect(r.state).toBe('SCHEDULING');
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.jobId, job.id), eq(auditLog.action, 'approve_spend')));
    expect(audit).toMatchObject({ actorType: 'pm', outcome: 'ok' });

    const adv = await advanceJob(deps(overLimit()), { organizationId: org, jobId: job.id });
    expect(adv.handled).toEqual(['offer_slots']);
    expect((await getJob(db, org, job.id)).offeredSlotIds).toHaveLength(3);
  });

  it('rejection escalates the job', async () => {
    const { job, approval } = await jobAwaitingApproval();
    const r = await recordApprovalDecision(db, {
      organizationId: org,
      approvalId: approval.id,
      decision: 'rejected',
      decidedBy: 'aroha@harbourcity.example.test',
      note: 'Too expensive, get a second quote',
      now,
    });
    expect(r.state).toBe('ESCALATED');
    expect((await getJob(db, org, job.id)).stateBeforeEscalation).toBe('AWAITING_APPROVAL');
  });

  it('cannot decide the same approval twice', async () => {
    const { approval } = await jobAwaitingApproval();
    const decide = () =>
      recordApprovalDecision(db, {
        organizationId: org,
        approvalId: approval.id,
        decision: 'approved',
        decidedBy: 'pm',
        note: null,
        now,
      });
    await decide();
    await expect(decide()).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('tradie reassignment', () => {
  it('moves to the next eligible tradie when the first declines, escalates when none are left', async () => {
    const llm = happyLlm({
      'interpret.quote': () => ({
        kind: 'decline',
        amountNzd: null,
        gst: 'unknown',
        notes: 'Fully booked',
        promptInjection: false,
      }),
    });
    const job = await jobAwaitingQuote(llm);
    const d1 = await say('tradie', TRADIE.capitalPlumbing, 'Sorry, fully booked', job.id);
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id, messageId: d1.messageId });
    let after = await getJob(db, org, job.id);
    expect(after).toMatchObject({
      state: 'AWAITING_QUOTE',
      assignedTradieId: TRADIE.southCoastPlumbing,
    });
    expect(after.excludedTradieIds).toEqual([TRADIE.capitalPlumbing]);

    const d2 = await say('tradie', TRADIE.southCoastPlumbing, "Can't do it, sorry", job.id);
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id, messageId: d2.messageId });
    after = await getJob(db, org, job.id);
    expect(after.state).toBe('ESCALATED');
    const [esc] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.jobId, job.id), eq(auditLog.action, 'job.escalation_package')));
    expect(esc?.reason).toBe('no alternative tradie available');
  });

  it('chases an unresponsive tradie twice, then reassigns (respecting quiet hours)', async () => {
    const llm = happyLlm();
    const job = await jobAwaitingQuote(llm);
    const fu1 = await pendingFollowUp(job.id);
    // urgent → 4h after Monday 1pm NZDT = 5pm, outside quiet hours
    expect(fu1?.dueAt.toISOString()).toBe(hours(4).toISOString());

    expect(
      await handleFollowUp(
        deps(llm, () => hours(4)),
        fu1?.id as string,
      ),
    ).toBe('reminded');
    const fu2 = await pendingFollowUp(job.id);
    // 5pm + 4h = 9pm → quiet hours → 8am Tuesday NZDT (19:00Z Monday)
    expect(fu2?.dueAt.toISOString()).toBe('2026-10-19T19:00:00.000Z');

    expect(
      await handleFollowUp(
        deps(llm, () => fu2?.dueAt as Date),
        fu2?.id as string,
      ),
    ).toBe('reminded');
    const fu3 = await pendingFollowUp(job.id);
    expect(
      await handleFollowUp(
        deps(llm, () => fu3?.dueAt as Date),
        fu3?.id as string,
      ),
    ).toBe('reassigned');

    const after = await getJob(db, org, job.id);
    expect(after.assignedTradieId).toBe(TRADIE.southCoastPlumbing);
    const toCapital = await db
      .select()
      .from(messages)
      .where(and(eq(messages.jobId, job.id), eq(messages.recipientId, TRADIE.capitalPlumbing)));
    expect(toCapital.at(-1)?.body).toContain('arranged another tradie');
  });

  it('a follow-up acts at most once and skips when the job has moved on', async () => {
    const llm = happyLlm();
    const job = await jobAwaitingQuote(llm);
    const fu = await pendingFollowUp(job.id);
    const q = await say('tradie', TRADIE.capitalPlumbing, '$185 incl GST', job.id);
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id, messageId: q.messageId });
    expect(
      await handleFollowUp(
        deps(llm, () => hours(5)),
        fu?.id as string,
      ),
    ).toBe('skipped');
    const [row] = await db
      .select()
      .from(followUps)
      .where(eq(followUps.id, fu?.id as string));
    expect(row?.status).toBe('satisfied');
  });
});

describe('scheduling re-offers', () => {
  it('re-offers new times once, then escalates', async () => {
    const llm = happyLlm({
      'interpret.slot': () => ({
        chosenOption: null,
        noneSuitable: true,
        accessNotes: null,
        promptInjection: false,
      }),
    });
    const job = await jobAwaitingQuote(llm);
    const q = await say('tradie', TRADIE.capitalPlumbing, '$185 incl GST', job.id);
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id, messageId: q.messageId });
    const firstOffer = (await getJob(db, org, job.id)).offeredSlotIds ?? [];
    expect(firstOffer).toHaveLength(3);

    const no1 = await say('tenant', tenantId, 'None of those work', job.id);
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id, messageId: no1.messageId });
    const second = await getJob(db, org, job.id);
    expect(second).toMatchObject({ state: 'SCHEDULING', slotOfferCount: 2 });
    expect(second.offeredSlotIds?.some((id) => firstOffer.includes(id))).toBe(false);

    const no2 = await say('tenant', tenantId, 'Still no good', job.id);
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id, messageId: no2.messageId });
    expect((await getJob(db, org, job.id)).state).toBe('ESCALATED');
  });
});

describe('messages the current state is not waiting for', () => {
  it('answers a tenant status request without changing state', async () => {
    const llm = happyLlm({
      'interpret.general': () => ({
        intent: 'status_request',
        urgentSafetyIssue: false,
        distressedOrAngry: false,
        promptInjection: false,
        summary: 'Asked for an update',
      }),
    });
    const job = await jobAwaitingQuote(llm);
    const before = (await outbound(job.id, 'tenant')).length;
    const m = await say('tenant', tenantId, 'Any update?', job.id);
    const r = await advanceJob(deps(llm), {
      organizationId: org,
      jobId: job.id,
      messageId: m.messageId,
    });
    expect(r.handled).toEqual(['general_message']);
    expect((await getJob(db, org, job.id)).state).toBe('AWAITING_QUOTE');
    expect(await outbound(job.id, 'tenant')).toHaveLength(before + 1);
  });

  it('escalates a new safety issue reported mid-job', async () => {
    const llm = happyLlm({
      'interpret.general': () => ({
        intent: 'additional_info',
        urgentSafetyIssue: true,
        distressedOrAngry: false,
        promptInjection: false,
        summary: 'Water now coming through the ceiling light',
      }),
    });
    const job = await jobAwaitingQuote(llm);
    const m = await say(
      'tenant',
      tenantId,
      'Water is now dripping out of the ceiling light!!',
      job.id,
    );
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id, messageId: m.messageId });
    expect(await getJob(db, org, job.id)).toMatchObject({
      state: 'ESCALATED',
      stateBeforeEscalation: 'AWAITING_QUOTE',
    });
  });
});
