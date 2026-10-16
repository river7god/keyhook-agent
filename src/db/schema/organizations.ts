import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps } from './columns';

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    timezone: text().notNull().default('Pacific/Auckland'),
    /** Fallback PM auto-approval limit when a PM has no personal limit. */
    defaultPmAutoApproveLimitCents: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    check('organizations_default_limit_nonneg', sql`${t.defaultPmAutoApproveLimitCents} >= 0`),
  ],
);

export const propertyManagers = pgTable(
  'property_managers',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    fullName: text().notNull(),
    email: text().notNull(),
    phone: text(),
    /** Null → use organizations.default_pm_auto_approve_limit_cents. */
    autoApproveLimitCents: integer(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('property_managers_org_id_uq').on(t.organizationId, t.id),
    unique('property_managers_org_email_uq').on(t.organizationId, t.email),
    check('property_managers_limit_nonneg', sql`${t.autoApproveLimitCents} >= 0`),
  ],
);
