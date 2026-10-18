import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, messages, monitorFindings, tenancies } from '@/db/schema';
import { PM, PROPERTY } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { createAgencyJob, getJob } from '@/domain/jobs';
import { dismissFinding, openFinding, scanRepeatedFaults } from '@/domain/portfolio-monitor';
import { cleanTriage, db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { advanceJob } from './advance';
import type { StructuredRequest } from './llm';

/* M8 (spec §12 R4, R7): inspection findings and Portfolio Monitor findings become work orders. */

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

function inspection(propertyId: string, notes: string) {
  return createAgencyJob(db, {
    organizationId: org,
    propertyId,
    source: 'inspection',
    actor: { type: 'pm', id: PM.aroha },
    title: 'Inspection finding',
    description: notes,
    reason: 'PM logged an inspection finding',
  });
}

async function toTenant(jobId: string) {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.jobId, jobId),
        eq(messages.direction, 'outbound'),
        eq(messages.recipientType, 'tenant'),
      ),
    );
}

describe('R4 inspection findings', () => {
  it('links the current tenant on a let property and triages from the notes', async () => {
    const job = await inspection(PROPERTY.newtown, 'Hot water cylinder pressure valve dripping');
    expect(job).toMatchObject({ source: 'inspection', reportedByTenantId: tenantId });

    let prompt = '';
    const llm = happyLlm({
      triage: (req: StructuredRequest<unknown>) => {
        prompt = req.user;
        return cleanTriage;
      },
    });
    const r = await advanceJob(deps(llm), { organizationId: org, jobId: job.id });
    expect(r.handled).toEqual(['triage', 'arrange_quote']);
    expect(prompt).toContain('Raised by: property inspection');
    expect(prompt).toContain('Hot water cylinder pressure valve dripping');
    expect((await getJob(db, org, job.id)).state).toBe('AWAITING_QUOTE');
    expect(await toTenant(job.id)).toHaveLength(2); // finding explained + quote requested
  });

  it('runs without a tenant on a vacant property', async () => {
    await db
      .update(tenancies)
      .set({ endDate: '2026-09-30' })
      .where(eq(tenancies.propertyId, PROPERTY.thorndon));
    const job = await inspection(PROPERTY.thorndon, 'Kitchen mixer tap loose and leaking at base');
    expect(job.reportedByTenantId).toBeNull();
    await advanceJob(deps(happyLlm()), { organizationId: org, jobId: job.id });
    expect((await getJob(db, org, job.id)).state).toBe('AWAITING_QUOTE');
    expect(await toTenant(job.id)).toHaveLength(0);
  });

  it('sends unclear notes back to the PM instead of asking the tenant', async () => {
    const job = await inspection(PROPERTY.newtown, 'Something wrong in the bathroom, check it');
    const llm = happyLlm({
      triage: () => ({
        ...cleanTriage,
        needsMoreInfo: true,
        confidence: 0.4,
        missingInfo: ['What is wrong in the bathroom?'],
        tenantReply: 'What is wrong in the bathroom?',
      }),
    });
    await advanceJob(deps(llm), { organizationId: org, jobId: job.id });
    expect((await getJob(db, org, job.id)).state).toBe('ESCALATED');
    expect(await toTenant(job.id)).toHaveLength(0);
  });

  it('rejects a property from another organization', async () => {
    await expect(
      createAgencyJob(db, {
        organizationId: org,
        propertyId: '00000000-0000-4000-8000-000000000000',
        source: 'inspection',
        actor: { type: 'pm', id: PM.aroha },
        title: 'x',
        description: 'Notes long enough',
        reason: 'test',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const created = await db.select().from(auditLog).where(eq(auditLog.action, 'job.created'));
    expect(created).toHaveLength(0);
  });
});

describe('R7 Portfolio Monitor', () => {
  async function findings() {
    return db.select().from(monitorFindings).where(eq(monitorFindings.organizationId, org));
  }
  const newtownPlumbing = async () =>
    (await findings()).filter((f) => f.propertyId === PROPERTY.newtown && f.trade === 'plumbing');

  it('flags three same-trade jobs at a property within 12 months, once', async () => {
    const first = await scanRepeatedFaults(db, org, now);
    expect(first.created).toBeGreaterThanOrEqual(1);
    const [f] = await newtownPlumbing();
    expect(f).toMatchObject({ status: 'open', kind: 'repeated_fault' });
    expect(f?.evidenceJobIds).toHaveLength(3);
    expect(f?.summary).toContain('3 plumbing jobs at 27 Rintoul Street');
    expect(f?.recommendation).toContain('cylinder replacement');

    expect(await scanRepeatedFaults(db, org, now)).toEqual({ created: 0, updated: 0 });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'monitor.finding'));
    expect(audits.length).toBe(first.created);
  });

  it('ignores jobs older than 12 months', async () => {
    await scanRepeatedFaults(db, org, new Date('2027-02-10T00:00:00Z'));
    expect(await newtownPlumbing()).toHaveLength(0);
  });

  it('re-raises a dismissed finding only when a new job adds evidence', async () => {
    await scanRepeatedFaults(db, org, now);
    const [f] = await newtownPlumbing();
    await dismissFinding(db, {
      organizationId: org,
      findingId: f?.id as string,
      propertyManagerId: PM.aroha,
      note: 'Owner replacing cylinder next month',
      now,
    });
    await scanRepeatedFaults(db, org, now);
    expect((await newtownPlumbing()).map((x) => x.status)).toEqual(['dismissed']);

    const m = await say('tenant', tenantId, 'No hot water again!');
    await advanceJob(deps(happyLlm()), {
      organizationId: org,
      jobId: m.jobId,
      messageId: m.messageId,
    });
    await scanRepeatedFaults(db, org, now);
    const open = (await newtownPlumbing()).find((x) => x.status === 'open');
    expect(open?.evidenceJobIds).toHaveLength(4);
  });

  it('a PM opens a finding as an agent_detected job the agent then works', async () => {
    await scanRepeatedFaults(db, org, now);
    const [f] = await newtownPlumbing();
    const open = () =>
      openFinding(db, {
        organizationId: org,
        findingId: f?.id as string,
        propertyManagerId: PM.aroha,
        note: 'Get a replacement quote',
        now,
      });
    const job = await open();
    expect(job).toMatchObject({ source: 'agent_detected', reportedByTenantId: tenantId });
    expect(job.description).toContain('PM note: Get a replacement quote');
    expect((await newtownPlumbing())[0]).toMatchObject({ status: 'opened', openedJobId: job.id });
    await expect(open()).rejects.toMatchObject({ code: 'CONFLICT' });

    await advanceJob(deps(happyLlm()), { organizationId: org, jobId: job.id });
    expect((await getJob(db, org, job.id)).state).toBe('AWAITING_QUOTE');
    // The monitor's own job is not evidence for a new finding.
    expect(await scanRepeatedFaults(db, org, now)).toEqual({ created: 0, updated: 0 });
  });
});
