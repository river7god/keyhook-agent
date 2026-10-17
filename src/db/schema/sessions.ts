import { foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, organizationId, tstz } from './columns';
import { organizations, propertyManagers } from './organizations';

/**
 * Server-side login sessions. The cookie holds a random token; only its SHA-256 is stored, so a
 * database leak does not leak usable sessions. Auth infrastructure: read before the organization
 * is known, so this table is deliberately outside row-level security (decisions.md).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    propertyManagerId: uuid().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: tstz().notNull(),
    createdAt: tstz().notNull().defaultNow(),
    lastSeenAt: tstz().notNull().defaultNow(),
    userAgent: text(),
  },
  (t) => [
    index('sessions_pm_idx').on(t.propertyManagerId),
    foreignKey({
      name: 'sessions_pm_fk',
      columns: [t.organizationId, t.propertyManagerId],
      foreignColumns: [propertyManagers.organizationId, propertyManagers.id],
    }).onDelete('cascade'),
  ],
);
