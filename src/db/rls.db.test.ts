import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, testDb } from '@/test/db';
import { jobs, organizations, properties, sessions, tenants } from './schema';
import { ORG, PROPERTY } from './seed/ids';
import { seed } from './seed/seed';
import { withOrg } from './org-scope';
import { expectPgError } from '@/test/pg-error';

const db = testDb();

beforeEach(async () => {
  await seed(db);
});
afterAll(async () => {
  await closeTestDb();
});

describe('row-level security', () => {
  it('only shows the current organization’s rows', async () => {
    const harbour = await withOrg(db, ORG.harbourCity, (tx) =>
      tx.select({ id: properties.id }).from(properties),
    );
    const aro = await withOrg(db, ORG.aroValley, (tx) =>
      tx.select({ id: properties.id }).from(properties),
    );
    expect(harbour).toHaveLength(10);
    expect(aro.map((p) => p.id)).toEqual([PROPERTY.aroValley]);
    const orgs = await withOrg(db, ORG.aroValley, (tx) => tx.select().from(organizations));
    expect(orgs.map((o) => o.id)).toEqual([ORG.aroValley]);
  });

  it('hides rows even when the query forgets the organization filter', async () => {
    const all = await withOrg(db, ORG.aroValley, (tx) =>
      tx.select({ id: tenants.id }).from(tenants),
    );
    expect(all).toHaveLength(1);
  });

  it('rejects writes for another organization', async () => {
    await expectPgError(
      withOrg(db, ORG.aroValley, (tx) =>
        tx.insert(jobs).values({
          organizationId: ORG.harbourCity,
          propertyId: PROPERTY.newtown,
          source: 'pm_created',
          createdByActorType: 'pm',
          title: 'x',
          description: 'x',
        }),
      ),
      { code: '42501' },
    );
  });

  it('cannot update another organization’s rows', async () => {
    await withOrg(db, ORG.aroValley, (tx) =>
      tx
        .update(properties)
        .set({ accessNotes: 'pwned' })
        .where(sql`${properties.id} = ${PROPERTY.newtown}`),
    );
    const [p] = await db
      .select()
      .from(properties)
      .where(sql`${properties.id} = ${PROPERTY.newtown}`);
    expect(p?.accessNotes).not.toBe('pwned');
  });

  it('fails closed without an organization context', async () => {
    await expectPgError(
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role keyhook_app`);
        return tx.select().from(properties);
      }),
      { code: '42501' }, // app.organization_id is not set
    );
  });

  it('keeps the request role away from login sessions', async () => {
    await expectPgError(
      withOrg(db, ORG.harbourCity, (tx) => tx.select().from(sessions)),
      { code: '42501' },
    );
  });

  it('has RLS enabled with a policy on every table that has organization_id', async () => {
    const rows = await db.execute<{ table_name: string; rls: boolean; policies: number }>(sql`
      select c.relname as table_name, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
        and exists (select 1 from information_schema.columns col
                    where col.table_schema = 'public' and col.table_name = c.relname
                      and col.column_name = 'organization_id')
        and c.relname <> 'sessions'`);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const r of rows) {
      expect(r, r.table_name).toMatchObject({ rls: true });
      expect(r.policies, r.table_name).toBeGreaterThan(0);
    }
  });
});
