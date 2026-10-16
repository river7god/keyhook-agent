import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps } from './columns';
import { organizations } from './organizations';

export const owners = pgTable(
  'owners',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    fullName: text().notNull(),
    email: text(),
    phone: text(),
    /** Spend above this always escalates (owner authority). */
    approvalLimitCents: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    unique('owners_org_id_uq').on(t.organizationId, t.id),
    check('owners_approval_limit_nonneg', sql`${t.approvalLimitCents} >= 0`),
  ],
);
