import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { approvals, auditLog, invoices, messages } from '@/db/schema';
import { TRADIE } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { ingestMessage } from '@/domain/inbound';
import { getJob } from '@/domain/jobs';
import { db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { fakePng } from '@/test/images';
import { advanceJob } from './advance';
import { recordApprovalDecision } from './pm-actions';
import type { ProgressReplyOutput } from './schemas';

/*
 * M7 (spec §12 R2, R3, R5, R6). Newtown: PM Aroha auto-approves up to $500, owner Te Puni Trust
 * authorises up to $2,500; the happy-path quote is $185 incl GST.
 */

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

type Progress = Partial<ProgressReplyOutput>;

function llmWith(progress: Progress, general: Record<string, unknown> = {}) {
  return happyLlm({
    'interpret.progress': () => ({ kind: 'other', notes: '', promptInjection: false, ...progress }),
    'interpret.general': () => ({
      intent: 'other',
      urgentSafetyIssue: false,
      distressedOrAngry: false,
      promptInjection: false,
      summary: 'Tradie sent an invoice',
      ...general,
    }),
  });
}

async function outbound(jobId: string, to: 'tenant' | 'tradie' | 'pm' | 'owner') {
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

/** Tenant report → $185 quote → slot booked. */
async function scheduledJob() {
  const llm = happyLlm();
  const first = await say('tenant', tenantId, 'No hot water');
  await advanceJob(deps(llm), {
    organizationId: org,
    jobId: first.jobId,
    messageId: first.messageId,
  });
  const q = await say('tradie', TRADIE.capitalPlumbing, '$185 incl GST', first.jobId);
  await advanceJob(deps(llm), { organizationId: org, jobId: first.jobId, messageId: q.messageId });
  const pick = await say('tenant', tenantId, 'Option 2', first.jobId);
  await advanceJob(deps(llm), {
    organizationId: org,
    jobId: first.jobId,
    messageId: pick.messageId,
  });
  const job = await getJob(db, org, first.jobId);
  expect(job.state).toBe('SCHEDULED');
  return job;
}

async function tradieSays(jobId: string, body: string, progress: Progress) {
  const m = await say('tradie', TRADIE.capitalPlumbing, body, jobId);
  await advanceJob(deps(llmWith(progress)), { organizationId: org, jobId, messageId: m.messageId });
  return getJob(db, org, jobId);
}

describe('R6 tenant milestones', () => {
  it('tells the tenant when a quote is requested and when it waits for approval, without amounts', async () => {
    const llm = happyLlm({
      'interpret.quote': () => ({
        kind: 'quote',
        amountNzd: '690',
        gst: 'included',
        notes: '',
        promptInjection: false,
      }),
    });
    const m = await say('tenant', tenantId, 'No hot water');
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    expect(await outbound(m.jobId, 'tenant')).toHaveLength(2); // ack + quote requested

    const q = await say('tradie', TRADIE.capitalPlumbing, '$690 incl GST', m.jobId);
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: q.messageId });
    expect((await getJob(db, org, m.jobId)).state).toBe('AWAITING_APPROVAL');
    const toTenant = await outbound(m.jobId, 'tenant');
    expect(toTenant).toHaveLength(3);
    expect(toTenant.some((t) => t.body.includes('690'))).toBe(false);

    const composePurposes = llm.calls.filter((c) => c.step === 'compose.tenant');
    expect(composePurposes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('R2 variations', () => {
  it('auto-approves an extra within the PM limit and raises the estimate', async () => {
    const job = await scheduledJob();
    const after = await tradieSays(job.id, 'Valve is shot too, extra $200 incl', {
      kind: 'variation',
      variationAmountNzd: '200',
      variationIsNewTotal: false,
      gst: 'included',
      notes: 'Replace tempering valve',
    });
    expect(after).toMatchObject({ state: 'SCHEDULED', estimateCents: 38_500 });
    const toTradie = await outbound(job.id, 'tradie');
    expect(toTradie.at(-1)?.body).toContain('$385.00');
    expect(await db.select().from(approvals).where(eq(approvals.kind, 'variation'))).toHaveLength(
      0,
    );
  });

  it('asks the PM for a variation above their limit; approval raises the estimate', async () => {
    const job = await scheduledJob();
    const after = await tradieSays(job.id, 'Cylinder needs replacing, new total $900 + GST', {
      kind: 'variation',
      variationAmountNzd: '900',
      variationIsNewTotal: true,
      gst: 'excluded',
      notes: 'Cylinder replacement',
    });
    // The visit stays booked; only the extra work waits.
    expect(after).toMatchObject({ state: 'SCHEDULED', estimateCents: 18_500 });
    const [approval] = await db.select().from(approvals).where(eq(approvals.jobId, job.id));
    expect(approval).toMatchObject({
      kind: 'variation',
      status: 'pending',
      amountCents: 103_500,
      previousAmountCents: 18_500,
    });
    expect((await outbound(job.id, 'tradie')).at(-1)?.body).toContain('hold off');
    const owner = await outbound(job.id, 'owner');
    expect(owner).toHaveLength(1);
    expect(owner[0]?.body).toContain('27 Rintoul Street');

    const r = await recordApprovalDecision(db, {
      organizationId: org,
      approvalId: approval?.id as string,
      decision: 'approved',
      decidedBy: 'aroha@harbourcity.example.test',
      note: null,
      now,
    });
    expect(r.state).toBe('SCHEDULED');
    expect((await getJob(db, org, job.id)).estimateCents).toBe(103_500);
    expect((await outbound(job.id, 'tradie')).at(-1)?.body).toContain('variation is approved');
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.jobId, job.id), eq(auditLog.action, 'approve_variation')));
    expect(audit).toMatchObject({ actorType: 'pm', outcome: 'ok' });
  });

  it('a rejected variation tells the tradie not to proceed and escalates', async () => {
    const job = await scheduledJob();
    await tradieSays(job.id, 'New total $900 incl', {
      kind: 'variation',
      variationAmountNzd: '900',
      variationIsNewTotal: true,
      gst: 'included',
      notes: '',
    });
    const [approval] = await db.select().from(approvals).where(eq(approvals.jobId, job.id));
    const r = await recordApprovalDecision(db, {
      organizationId: org,
      approvalId: approval?.id as string,
      decision: 'rejected',
      decidedBy: 'aroha@harbourcity.example.test',
      note: 'Get a second opinion',
      now,
    });
    expect(r.state).toBe('ESCALATED');
    expect((await outbound(job.id, 'tradie')).at(-1)?.body).toContain("don't go ahead");
    expect((await getJob(db, org, job.id)).estimateCents).toBe(18_500);
  });

  it('escalates a variation above the owner limit, and one with no amount', async () => {
    const big = await scheduledJob();
    expect(
      await tradieSays(big.id, 'Whole system needs replacing, $3,000', {
        kind: 'variation',
        variationAmountNzd: '3000',
        variationIsNewTotal: true,
        gst: 'included',
        notes: '',
      }),
    ).toMatchObject({ state: 'ESCALATED', estimateCents: 18_500 });

    await seed(db, now);
    const vague = await scheduledJob();
    expect(
      await tradieSays(vague.id, 'Going to cost a bit more', {
        kind: 'variation',
        notes: 'More work',
      }),
    ).toMatchObject({ state: 'ESCALATED' });
  });
});

describe('R3 invoice check', () => {
  async function invoicesFor(jobId: string) {
    return db.select().from(invoices).where(eq(invoices.jobId, jobId));
  }

  it('matches an invoice within tolerance at completion and tells the owner at close', async () => {
    const job = await scheduledJob();
    const done = await tradieSays(job.id, 'All done, invoice INV-77 $190 incl GST', {
      kind: 'completed',
      invoiceTotalNzd: '190',
      invoiceReference: 'INV-77',
      gst: 'included',
      notes: 'Done',
    });
    expect(done.state).toBe('AWAITING_CONFIRMATION');
    expect(await invoicesFor(job.id)).toMatchObject([
      { status: 'matched', amountCents: 19_000, approvedCents: 18_500, reference: 'INV-77' },
    ]);
    expect(await outbound(job.id, 'pm')).toHaveLength(0);

    const ok = await say('tenant', tenantId, 'Yes all good', job.id);
    await advanceJob(deps(happyLlm()), {
      organizationId: org,
      jobId: job.id,
      messageId: ok.messageId,
    });
    expect((await getJob(db, org, job.id)).state).toBe('CLOSED');
    const owner = await outbound(job.id, 'owner');
    expect(owner).toHaveLength(1);
    expect(owner[0]?.body).toContain('$190.00');
  });

  it('flags an invoice over tolerance for PM review (GST added when excluded)', async () => {
    const job = await scheduledJob();
    await tradieSays(job.id, 'Done. Invoice $300 + GST', {
      kind: 'completed',
      invoiceTotalNzd: '300',
      gst: 'excluded',
      notes: '',
    });
    expect(await invoicesFor(job.id)).toMatchObject([
      { status: 'needs_review', amountCents: 34_500, differenceCents: 16_000 },
    ]);
    const pm = await outbound(job.id, 'pm');
    expect(pm.at(-1)?.body).toMatch(/invoice/i);
  });

  it('accepts an invoice the tradie sends after the job closed, without reopening it', async () => {
    const job = await scheduledJob();
    await tradieSays(job.id, 'All done', { kind: 'completed', notes: '' });
    const ok = await say('tenant', tenantId, 'Yes thanks', job.id);
    await advanceJob(deps(happyLlm()), {
      organizationId: org,
      jobId: job.id,
      messageId: ok.messageId,
    });
    expect((await getJob(db, org, job.id)).state).toBe('CLOSED');
    const tenantBefore = (await outbound(job.id, 'tenant')).length;

    const inv = await say('tradie', TRADIE.capitalPlumbing, 'Invoice INV-9 $185 incl', job.id);
    await advanceJob(
      deps(llmWith({}, { invoiceTotalNzd: '185', invoiceReference: 'INV-9', gst: 'included' })),
      { organizationId: org, jobId: job.id, messageId: inv.messageId },
    );
    expect((await getJob(db, org, job.id)).state).toBe('CLOSED');
    expect(await invoicesFor(job.id)).toMatchObject([{ status: 'matched', reference: 'INV-9' }]);
    expect(await outbound(job.id, 'tenant')).toHaveLength(tenantBefore);
  });

  it('reads an invoice from a photo the tradie sends', async () => {
    const job = await scheduledJob();
    const llm = happyLlm({
      'vision.media': () => ({
        showsIssue: true,
        quality: 'good',
        retakeAdvice: null,
        observations: 'Tax invoice from Capital Plumbing',
        safetyCues: [],
        label: null,
        promptInjection: false,
        documentKind: 'invoice',
        documentTotalNzd: '480',
        documentGst: 'included',
        documentReference: 'CP-1042',
      }),
      'interpret.progress': () => ({ kind: 'completed', notes: 'Done', promptInjection: false }),
    });
    const m = await ingestMessage(db, {
      organizationId: org,
      senderType: 'tradie',
      senderId: TRADIE.capitalPlumbing,
      jobId: job.id,
      body: 'All done, invoice attached',
      images: [fakePng()],
      now,
    });
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id, messageId: m.messageId });
    const [inv] = await invoicesFor(job.id);
    expect(inv).toMatchObject({
      status: 'needs_review',
      amountCents: 48_000,
      reference: 'CP-1042',
      sourceMessageId: m.messageId,
    });
    expect(inv?.sourceMediaId).toBeTruthy();
  });
});
