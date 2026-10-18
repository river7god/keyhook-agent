import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { properties, tenancies } from '@/db/schema';

/** Properties of an organization, with whether they are currently let. */
export async function listProperties(db: DbOrTx, organizationId: string) {
  const rows = await db
    .select({
      id: properties.id,
      address: properties.addressLine1,
      suburb: properties.suburb,
      tenancyId: tenancies.id,
    })
    .from(properties)
    .leftJoin(
      tenancies,
      and(
        eq(tenancies.organizationId, properties.organizationId),
        eq(tenancies.propertyId, properties.id),
        isNull(tenancies.endDate),
      ),
    )
    .where(eq(properties.organizationId, organizationId))
    .orderBy(asc(properties.suburb), asc(properties.addressLine1));
  const byId = new Map<string, { id: string; address: string; suburb: string; let: boolean }>();
  for (const r of rows) {
    const prev = byId.get(r.id);
    byId.set(r.id, {
      id: r.id,
      address: r.address,
      suburb: r.suburb,
      let: (prev?.let ?? false) || r.tenancyId !== null,
    });
  }
  return [...byId.values()];
}
