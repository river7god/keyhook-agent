import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, testDb, truncateAll } from '@/test/db';
import { createOrgGraph } from '@/test/fixtures';
import { expectPgError } from '@/test/pg-error';
import { approvals, auditLog, jobs, messages, properties, tenancyTenants, tenants } from './index';

const db = testDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await closeTestDb();
});

async function insertJob(g: Awaited<ReturnType<typeof createOrgGraph>>) {
  const [job] = await db
    .insert(jobs)
    .values({
      organizationId: g.org.id,
      propertyId: g.property.id,
      tenancyId: g.tenancy.id,
      reportedByTenantId: g.tenant.id,
      source: 'tenant_message',
      createdByActorType: 'tenant',
      createdByActorId: g.tenant.id,
      title: 'No hot water',
      description: 'Shower has been cold since this morning',
    })
    .returning();
  if (!job) throw new Error('job insert failed');
  return job;
}

describe('multi-tenant isolation (composite FKs)', () => {
  it('rejects a property whose owner belongs to another organization', async () => {
    const a = await createOrgGraph(db);
    const b = await createOrgGraph(db);
    await expectPgError(
      db.insert(properties).values({
        organizationId: a.org.id,
        ownerId: b.owner.id,
        propertyManagerId: a.pm.id,
        addressLine1: '2 Leak Lane',
        suburb: 'Newtown',
        postcode: '6021',
      }),
      { constraint: 'properties_owner_fk' },
    );
  });

  it('rejects a job that points at another organization’s property', async () => {
    const a = await createOrgGraph(db);
    const b = await createOrgGraph(db);
    await expectPgError(
      db.insert(jobs).values({
        organizationId: a.org.id,
        propertyId: b.property.id,
        source: 'pm_created',
        createdByActorType: 'pm',
        title: 'x',
        description: 'x',
      }),
      { constraint: 'jobs_property_fk' },
    );
  });
});

describe('jobs constraints', () => {
  it('defaults new jobs to RECEIVED with version 0', async () => {
    const g = await createOrgGraph(db);
    const job = await insertJob(g);
    expect(job.state).toBe('RECEIVED');
    expect(job.version).toBe(0);
  });

  it('requires a reporting tenant when source is tenant_message', async () => {
    const g = await createOrgGraph(db);
    await expectPgError(
      db.insert(jobs).values({
        organizationId: g.org.id,
        propertyId: g.property.id,
        source: 'tenant_message',
        createdByActorType: 'tenant',
        title: 'x',
        description: 'x',
      }),
      { constraint: 'jobs_tenant_source_has_reporter' },
    );
  });

  it('allows agent-detected jobs without a reporting tenant', async () => {
    const g = await createOrgGraph(db);
    const [job] = await db
      .insert(jobs)
      .values({
        organizationId: g.org.id,
        propertyId: g.property.id,
        source: 'agent_detected',
        createdByActorType: 'agent',
        title: 'Third hot-water fault this year',
        description: 'Repeated issue detected across past jobs',
      })
      .returning();
    expect(job?.reportedByTenantId).toBeNull();
  });

  it('requires state_before_escalation exactly when ESCALATED', async () => {
    const g = await createOrgGraph(db);
    const job = await insertJob(g);
    await expectPgError(db.update(jobs).set({ state: 'ESCALATED' }).where(eq(jobs.id, job.id)), {
      constraint: 'jobs_escalation_consistent',
    });
    await expectPgError(
      db.update(jobs).set({ stateBeforeEscalation: 'TRIAGED' }).where(eq(jobs.id, job.id)),
      { constraint: 'jobs_escalation_consistent' },
    );
    await db
      .update(jobs)
      .set({ state: 'ESCALATED', stateBeforeEscalation: 'RECEIVED' })
      .where(eq(jobs.id, job.id));
  });

  it('rejects out-of-range confidence and negative estimates', async () => {
    const g = await createOrgGraph(db);
    const job = await insertJob(g);
    await expectPgError(db.update(jobs).set({ triageConfidence: 1.2 }).where(eq(jobs.id, job.id)), {
      constraint: 'jobs_confidence_range',
    });
    await expectPgError(db.update(jobs).set({ estimateCents: -1 }).where(eq(jobs.id, job.id)), {
      constraint: 'jobs_estimate_nonneg',
    });
  });
});

describe('messages', () => {
  it('requires an idempotency key on outbound messages', async () => {
    const g = await createOrgGraph(db);
    await expectPgError(
      db.insert(messages).values({
        organizationId: g.org.id,
        direction: 'outbound',
        senderType: 'agent',
        recipientType: 'tenant',
        recipientId: g.tenant.id,
        body: 'Hi',
        status: 'queued',
      }),
      { constraint: 'messages_outbound_has_idempotency_key' },
    );
  });

  it('rejects a duplicate idempotency key within an organization', async () => {
    const g = await createOrgGraph(db);
    const row = {
      organizationId: g.org.id,
      direction: 'outbound' as const,
      senderType: 'agent' as const,
      recipientType: 'tenant' as const,
      body: 'Hi',
      status: 'queued' as const,
      idempotencyKey: 'send:abc',
    };
    await db.insert(messages).values(row);
    await expectPgError(db.insert(messages).values(row), {
      constraint: 'messages_org_idempotency_uq',
    });
  });
});

describe('approvals', () => {
  it('allows only one pending approval per job', async () => {
    const g = await createOrgGraph(db);
    const job = await insertJob(g);
    const base = { organizationId: g.org.id, jobId: job.id, amountCents: 45_000, reason: 'Quote' };
    await db.insert(approvals).values({ ...base, idempotencyKey: 'a1' });
    await expectPgError(db.insert(approvals).values({ ...base, idempotencyKey: 'a2' }), {
      constraint: 'approvals_one_pending_per_job_uq',
    });
  });

  it('requires decided_by and decided_at once approved', async () => {
    const g = await createOrgGraph(db);
    const job = await insertJob(g);
    await expectPgError(
      db.insert(approvals).values({
        organizationId: g.org.id,
        jobId: job.id,
        amountCents: 45_000,
        reason: 'Quote',
        status: 'approved',
        idempotencyKey: 'a1',
      }),
      { constraint: 'approvals_decision_recorded' },
    );
  });
});

describe('tenancy_tenants', () => {
  it('allows only one primary contact per tenancy', async () => {
    const g = await createOrgGraph(db);
    const [flatmate] = await db
      .insert(tenants)
      .values({ organizationId: g.org.id, fullName: 'Flatmate' })
      .returning();
    if (!flatmate) throw new Error('insert failed');
    await expectPgError(
      db.insert(tenancyTenants).values({
        organizationId: g.org.id,
        tenancyId: g.tenancy.id,
        tenantId: flatmate.id,
        isPrimaryContact: true,
      }),
      { constraint: 'tenancy_tenants_one_primary_uq' },
    );
  });
});

describe('audit_log is append-only', () => {
  it('rejects UPDATE and DELETE', async () => {
    const g = await createOrgGraph(db);
    const [row] = await db
      .insert(auditLog)
      .values({
        organizationId: g.org.id,
        actorType: 'agent',
        action: 'test.event',
        outcome: 'ok',
        input: { a: 1 },
      })
      .returning();
    if (!row) throw new Error('insert failed');

    await expectPgError(
      db.update(auditLog).set({ reason: 'tampered' }).where(eq(auditLog.id, row.id)),
      { code: '42501' },
    );
    await expectPgError(db.delete(auditLog).where(eq(auditLog.id, row.id)), { code: '42501' });

    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
    expect(count?.n).toBe(1);
  });
});
