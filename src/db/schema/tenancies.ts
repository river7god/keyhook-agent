import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps } from './columns';
import { organizations } from './organizations';
import { properties } from './properties';

export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    fullName: text().notNull(),
    phone: text(),
    email: text(),
    /** BCP-47 tag; replies go out in this language. */
    preferredLanguage: text().notNull().default('en'),
    ...timestamps,
  },
  (t) => [unique('tenants_org_id_uq').on(t.organizationId, t.id)],
);

export const tenancies = pgTable(
  'tenancies',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    propertyId: uuid().notNull(),
    startDate: date({ mode: 'string' }).notNull(),
    /** Null = periodic / ongoing. */
    endDate: date({ mode: 'string' }),
    ...timestamps,
  },
  (t) => [
    unique('tenancies_org_id_uq').on(t.organizationId, t.id),
    index('tenancies_org_property_idx').on(t.organizationId, t.propertyId),
    check('tenancies_dates_ordered', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    foreignKey({
      name: 'tenancies_property_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }),
  ],
);

/** Many-to-many: flatmates / couples share one tenancy. */
export const tenancyTenants = pgTable(
  'tenancy_tenants',
  {
    organizationId: organizationId().references(() => organizations.id),
    tenancyId: uuid().notNull(),
    tenantId: uuid().notNull(),
    isPrimaryContact: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.tenancyId, t.tenantId] }),
    index('tenancy_tenants_tenant_idx').on(t.organizationId, t.tenantId),
    uniqueIndex('tenancy_tenants_one_primary_uq')
      .on(t.tenancyId)
      .where(sql`${t.isPrimaryContact}`),
    foreignKey({
      name: 'tenancy_tenants_tenancy_fk',
      columns: [t.organizationId, t.tenancyId],
      foreignColumns: [tenancies.organizationId, tenancies.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'tenancy_tenants_tenant_fk',
      columns: [t.organizationId, t.tenantId],
      foreignColumns: [tenants.organizationId, tenants.id],
    }),
  ],
);
