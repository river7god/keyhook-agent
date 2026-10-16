import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import {
  organizations,
  owners,
  properties,
  propertyManagers,
  tenancies,
  tenancyTenants,
  tenants,
} from '@/db/schema';

/** Minimal valid graph for one organization. Overrides keep tests focused on what they assert. */
export async function createOrgGraph(
  db: Db,
  opts: {
    orgDefaultLimitCents?: number;
    pmLimitCents?: number | null;
    ownerLimitCents?: number;
  } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organizations)
    .values({
      name: `Test Org ${suffix}`,
      slug: `test-org-${suffix}`,
      defaultPmAutoApproveLimitCents: opts.orgDefaultLimitCents ?? 30_000,
    })
    .returning();
  if (!org) throw new Error('org insert failed');
  const organizationId = org.id;

  const [pm] = await db
    .insert(propertyManagers)
    .values({
      organizationId,
      fullName: 'Test PM',
      email: `pm-${suffix}@example.test`,
      autoApproveLimitCents: opts.pmLimitCents ?? null,
    })
    .returning();
  const [owner] = await db
    .insert(owners)
    .values({
      organizationId,
      fullName: 'Test Owner',
      approvalLimitCents: opts.ownerLimitCents ?? 100_000,
    })
    .returning();
  if (!pm || !owner) throw new Error('pm/owner insert failed');

  const [property] = await db
    .insert(properties)
    .values({
      organizationId,
      ownerId: owner.id,
      propertyManagerId: pm.id,
      addressLine1: '1 Test Street',
      suburb: 'Te Aro',
      postcode: '6011',
    })
    .returning();
  if (!property) throw new Error('property insert failed');

  const [tenant] = await db
    .insert(tenants)
    .values({ organizationId, fullName: 'Test Tenant' })
    .returning();
  const [tenancy] = await db
    .insert(tenancies)
    .values({ organizationId, propertyId: property.id, startDate: '2026-01-01' })
    .returning();
  if (!tenant || !tenancy) throw new Error('tenant/tenancy insert failed');
  await db
    .insert(tenancyTenants)
    .values({ organizationId, tenancyId: tenancy.id, tenantId: tenant.id, isPrimaryContact: true });

  return { org, pm, owner, property, tenant, tenancy };
}
