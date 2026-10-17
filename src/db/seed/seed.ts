import type { Db } from '@/db/client';
import {
  jobs,
  organizations,
  owners,
  properties,
  propertyManagers,
  tenancies,
  tenancyTenants,
  tenants,
  tradieAvailability,
  tradies,
} from '@/db/schema';
import { hashPassword } from '@/lib/password';
import { truncateAllTables } from '../truncate';
import { availabilityRows } from './data/availability';
import { jobRows } from './data/jobs';
import { organizationRows, ownerRows, propertyManagerRows } from './data/organizations';
import { propertyRows } from './data/properties';
import { tenancyRows, tenancyTenantRows, tenantRows } from './data/tenancies';
import { tradieRows } from './data/tradies';

/** Wipe and re-insert all seed data in one transaction. Idempotent. */
export async function seed(db: Db, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await truncateAllTables(tx);
    await tx.insert(organizations).values(organizationRows);
    const passwordHash = await seedPasswordHash();
    await tx
      .insert(propertyManagers)
      .values(propertyManagerRows.map((pm) => ({ ...pm, passwordHash })));
    await tx.insert(owners).values(ownerRows);
    await tx.insert(properties).values(propertyRows);
    await tx.insert(tenants).values(tenantRows);
    await tx.insert(tenancies).values(tenancyRows);
    await tx.insert(tenancyTenants).values(tenancyTenantRows);
    await tx.insert(tradies).values(tradieRows);
    await tx.insert(jobs).values(jobRows);
    await tx.insert(tradieAvailability).values(availabilityRows(now));
  });
}

/**
 * Every seeded PM gets the same password: SEED_PM_PASSWORD, default "keyhook-demo" (dev/demo
 * only — set a real one before seeding anything reachable). Hashed once per process.
 */
let cachedHash: Promise<string> | undefined;
function seedPasswordHash(): Promise<string> {
  cachedHash ??= hashPassword(process.env.SEED_PM_PASSWORD ?? 'keyhook-demo');
  return cachedHash;
}
