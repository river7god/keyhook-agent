import { and, count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  jobs,
  organizations,
  properties,
  tenancies,
  tenancyTenants,
  tenants,
  tradies,
} from '@/db/schema';
import { decideApproval, loadApprovalLimits } from '@/domain/approval-policy';
import { closeTestDb, testDb } from '@/test/db';
import { ORG, PROPERTY } from './ids';
import { seed } from './seed';

const db = testDb();

beforeAll(async () => {
  await seed(db);
});
afterAll(async () => {
  await closeTestDb();
});

async function countWhere(
  table: typeof properties | typeof tradies | typeof tenancies,
  org: string,
) {
  const [row] = await db.select({ n: count() }).from(table).where(eq(table.organizationId, org));
  return row?.n ?? 0;
}

describe('seed', () => {
  it('matches the spec volumes for Harbour City', async () => {
    expect(await countWhere(properties, ORG.harbourCity)).toBe(10);
    expect(await countWhere(tenancies, ORG.harbourCity)).toBe(15);
    expect(await countWhere(tradies, ORG.harbourCity)).toBe(8);
  });

  it('covers all five spec trades with active tradies', async () => {
    const rows = await db
      .select({ trades: tradies.trades })
      .from(tradies)
      .where(and(eq(tradies.organizationId, ORG.harbourCity), eq(tradies.active, true)));
    const covered = new Set(rows.flatMap((r) => r.trades));
    for (const t of ['plumbing', 'electrical', 'heating', 'handyman', 'locksmith'] as const) {
      expect(covered).toContain(t);
    }
  });

  it('gives every current tenancy exactly one primary contact', async () => {
    const current = await db
      .select({ id: tenancies.id })
      .from(tenancies)
      .where(isNull(tenancies.endDate));
    for (const t of current) {
      const primaries = await db
        .select({ n: count() })
        .from(tenancyTenants)
        .where(and(eq(tenancyTenants.tenancyId, t.id), eq(tenancyTenants.isPrimaryContact, true)));
      expect(primaries[0]?.n).toBe(1);
    }
  });

  it('includes non-English-speaking tenants', async () => {
    const rows = await db.select({ lang: tenants.preferredLanguage }).from(tenants);
    expect(rows.some((r) => r.lang !== 'en')).toBe(true);
  });

  it('has repeated hot-water history at Newtown', async () => {
    const [row] = await db
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.propertyId, PROPERTY.newtown), eq(jobs.state, 'CLOSED')));
    expect(row?.n).toBe(3);
  });

  it('caps the PM limit by a low owner limit (Miramar)', async () => {
    const limits = await loadApprovalLimits(db, ORG.harbourCity, PROPERTY.miramar);
    // Aroha's personal $500 limit is capped by the owner's $200.
    expect(decideApproval(20_000, limits).kind).toBe('auto_approve');
    expect(decideApproval(20_001, limits).kind).toBe('escalate');
  });

  it('is idempotent', async () => {
    await seed(db);
    const [row] = await db.select({ n: count() }).from(organizations);
    expect(row?.n).toBe(2);
  });
});
