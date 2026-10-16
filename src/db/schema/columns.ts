import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** All timestamps are timestamptz, stored UTC (CLAUDE.md rule 6). */
export const tstz = () => timestamp({ withTimezone: true, mode: 'date' });

export const id = () => uuid().primaryKey().defaultRandom();

export const timestamps = {
  createdAt: tstz().notNull().defaultNow(),
  updatedAt: tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Every business table carries organization_id (SaaS tenant = property-management agency).
 * Child tables use composite foreign keys (organization_id, x_id) so the database itself
 * rejects cross-organization references.
 */
export const organizationId = () => uuid().notNull();
