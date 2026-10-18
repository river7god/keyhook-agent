import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, messages, tenancies } from '@/db/schema';
import { PM, PROPERTY } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { createAgencyJob, getJob } from '@/domain/jobs';
import { cleanTriage, db, deps, happyLlm, now, org, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { advanceJob } from './advance';
import type { StructuredRequest } from './llm';

/* M8 (spec §12 R4): inspection findings become work orders. */

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
