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
  tradies,
} from '@/db/schema';
import { truncateAllTables } from '../truncate';
import { jobRows } from './data/jobs';
import { organizationRows, ownerRows, propertyManagerRows } from './data/organizations';
import { propertyRows } from './data/properties';
import { tenancyRows, tenancyTenantRows, tenantRows } from './data/tenancies';
import { tradieRows } from './data/tradies';

/** Wipe and re-insert all seed data in one transaction. Idempotent. */
export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await truncateAllTables(tx);
    await tx.insert(organizations).values(organizationRows);
    await tx.insert(propertyManagers).values(propertyManagerRows);
    await tx.insert(owners).values(ownerRows);
    await tx.insert(properties).values(propertyRows);
    await tx.insert(tenants).values(tenantRows);
    await tx.insert(tenancies).values(tenancyRows);
    await tx.insert(tenancyTenants).values(tenancyTenantRows);
    await tx.insert(tradies).values(tradieRows);
    await tx.insert(jobs).values(jobRows);
  });
}
