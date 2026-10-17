import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { properties, tenancies, tenancyTenants, tenants, tradies } from '@/db/schema';

/** Tenants with a current tenancy, and active tradies — the identities the simulator can act as. */
export async function listPersonas(db: DbOrTx, organizationId: string) {
  const [tenantRows, tradieRows] = await Promise.all([
    db
      .select({
        id: tenants.id,
        name: tenants.fullName,
        language: tenants.preferredLanguage,
        address: properties.addressLine1,
        suburb: properties.suburb,
      })
      .from(tenants)
      .innerJoin(
        tenancyTenants,
        and(
          eq(tenancyTenants.organizationId, tenants.organizationId),
          eq(tenancyTenants.tenantId, tenants.id),
        ),
      )
      .innerJoin(
        tenancies,
        and(
          eq(tenancies.organizationId, tenancyTenants.organizationId),
          eq(tenancies.id, tenancyTenants.tenancyId),
        ),
      )
      .innerJoin(
        properties,
        and(
          eq(properties.organizationId, tenancies.organizationId),
          eq(properties.id, tenancies.propertyId),
        ),
      )
      .where(and(eq(tenants.organizationId, organizationId), isNull(tenancies.endDate)))
      .orderBy(asc(properties.suburb), asc(tenants.fullName)),
    db
      .select({ id: tradies.id, name: tradies.businessName, trades: tradies.trades })
      .from(tradies)
      .where(and(eq(tradies.organizationId, organizationId), eq(tradies.active, true)))
      .orderBy(asc(tradies.businessName)),
  ]);
  return { tenants: tenantRows, tradies: tradieRows };
}
