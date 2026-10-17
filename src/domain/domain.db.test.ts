import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, idempotencyKeys } from '@/db/schema';
import { ORG, PROPERTY, TRADIE } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { closeTestDb, testDb } from '@/test/db';
import { primaryTenantFor, currentTenancyFor } from '@/db/seed/data/tenancies';
import { DomainError } from './errors';
import { withIdempotency } from './idempotency';
import { createJobFromTenantMessage, getJob, transitionJob } from './jobs';
import { findEligibleTradies, listFreeSlots } from './tradie-selection';

const db = testDb();
const org = ORG.harbourCity;
const newtownTenant = primaryTenantFor(currentTenancyFor(PROPERTY.newtown).id);
const now = new Date('2026-10-19T00:00:00Z');

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

const agent = { type: 'agent' as const };
const pm = { type: 'pm' as const, id: 'aroha@harbourcity.example.test' };

describe('createJobFromTenantMessage', () => {
  it('opens a RECEIVED job on the tenant’s current property and audits it', async () => {
    const job = await createJobFromTenantMessage(db, {
      organizationId: org,
      tenantId: newtownTenant,
      body: 'No hot water since this morning',
    });
    expect(job).toMatchObject({ state: 'RECEIVED', propertyId: PROPERTY.newtown });
    const audits = await db.select().from(auditLog).where(eq(auditLog.jobId, job.id));
    expect(audits.map((a) => a.action)).toEqual(['job.created']);
  });

  it('refuses a tenant from another organization', async () => {
    await expect(
      createJobFromTenantMessage(db, {
        organizationId: ORG.aroValley,
        tenantId: newtownTenant,
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('transitionJob', () => {
  async function newJob() {
    return createJobFromTenantMessage(db, {
      organizationId: org,
      tenantId: newtownTenant,
      body: 'Leak under the sink',
    });
  }

  it('applies allowed transitions, bumps version and audits', async () => {
    const job = await newJob();
    const triaged = await transitionJob(db, {
      organizationId: org,
      jobId: job.id,
      to: 'TRIAGED',
      actor: agent,
      reason: 'Triage complete',
      patch: { urgency: 'urgent', trade: 'plumbing', triageConfidence: 0.92 },
    });
    expect(triaged).toMatchObject({ state: 'TRIAGED', version: 1, urgency: 'urgent' });
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.jobId, job.id), eq(auditLog.action, 'job.transition')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('ok');
  });

  it('rejects disallowed transitions and audits the rejection', async () => {
    const job = await newJob();
    await expect(
      transitionJob(db, {
        organizationId: org,
        jobId: job.id,
        to: 'SCHEDULED',
        actor: agent,
        reason: 'skip',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.jobId, job.id), eq(auditLog.action, 'job.transition')));
    expect(row?.outcome).toBe('rejected');
    expect((await getJob(db, org, job.id)).state).toBe('RECEIVED');
  });

  it('enforces optimistic locking', async () => {
    const job = await newJob();
    await expect(
      transitionJob(db, {
        organizationId: org,
        jobId: job.id,
        to: 'TRIAGED',
        actor: agent,
        reason: 'stale',
        expectedVersion: 5,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('records and clears state_before_escalation', async () => {
    const job = await newJob();
    const escalated = await transitionJob(db, {
      organizationId: org,
      jobId: job.id,
      to: 'ESCALATED',
      actor: agent,
      reason: 'Gas smell',
    });
    expect(escalated.stateBeforeEscalation).toBe('RECEIVED');
    const back = await transitionJob(db, {
      organizationId: org,
      jobId: job.id,
      to: 'RECEIVED',
      actor: pm,
      reason: 'False alarm',
    });
    expect(back).toMatchObject({ state: 'RECEIVED', stateBeforeEscalation: null });
  });
});

describe('withIdempotency', () => {
  const args = { organizationId: org, key: 'k1', tool: 'test', request: { a: 1, b: [2] } };

  it('runs the effect once and replays the stored result', async () => {
    let runs = 0;
    const first = await withIdempotency(db, args, () => Promise.resolve({ n: ++runs }));
    const second = await withIdempotency(db, { ...args, request: { b: [2], a: 1 } }, () =>
      Promise.resolve({ n: ++runs }),
    );
    expect(first).toEqual({ result: { n: 1 }, replayed: false });
    expect(second).toEqual({ result: { n: 1 }, replayed: true });
    expect(runs).toBe(1);
  });

  it('rejects the same key with a different request', async () => {
    await withIdempotency(db, args, () => Promise.resolve(1));
    await expect(
      withIdempotency(db, { ...args, request: { a: 2 } }, () => Promise.resolve(2)),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  });

  it('rolls the key back with a failed transaction', async () => {
    await expect(
      db.transaction(async (tx) =>
        withIdempotency(tx, args, () => Promise.reject(new Error('boom'))),
      ),
    ).rejects.toThrow('boom');
    expect(await db.select().from(idempotencyKeys)).toHaveLength(0);
  });
});

describe('findEligibleTradies', () => {
  const query = {
    organizationId: org,
    trade: 'plumbing' as const,
    suburb: 'Newtown',
    urgency: 'urgent' as const,
    propertyId: PROPERTY.newtown,
    now,
    horizonHours: 24 * 7,
  };

  it('returns active plumbers covering the suburb, never the inactive one', async () => {
    const ids = (await findEligibleTradies(db, query)).map((c) => c.tradieId).sort();
    expect(ids).toEqual([TRADIE.capitalPlumbing, TRADIE.southCoastPlumbing].sort());
  });

  it('counts past jobs at the property (familiarity)', async () => {
    const capital = (await findEligibleTradies(db, query)).find(
      (c) => c.tradieId === TRADIE.capitalPlumbing,
    );
    expect(capital?.pastJobsAtProperty).toBe(2);
    expect(capital?.earliestFreeSlot).toBeInstanceOf(Date);
  });

  it('requires emergency call-outs for emergencies', async () => {
    const ids = (await findEligibleTradies(db, { ...query, urgency: 'emergency' })).map(
      (c) => c.tradieId,
    );
    expect(ids).toEqual([TRADIE.capitalPlumbing]);
  });

  it('never returns another organization’s tradies', async () => {
    const ids = (await findEligibleTradies(db, { ...query, suburb: 'Aro Valley' })).map(
      (c) => c.tradieId,
    );
    expect(ids).not.toContain(TRADIE.aroValleyHandyman);
  });

  it('lists future free slots soonest first', async () => {
    const slots = await listFreeSlots(db, {
      organizationId: org,
      tradieId: TRADIE.capitalPlumbing,
      now,
      limit: 3,
    });
    expect(slots.length).toBeGreaterThan(0);
    const starts = slots.map((s) => s.startsAt.getTime());
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(starts[0]).toBeGreaterThan(now.getTime());
  });
});
