import { jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { organizationId, tstz } from './columns';
import { organizations } from './organizations';

/**
 * Rule 3: a side-effecting tool retried with the same key returns the stored response instead of
 * acting twice. Same key + different request hash = caller bug → error.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    organizationId: organizationId().references(() => organizations.id),
    key: text().notNull(),
    tool: text().notNull(),
    requestHash: text().notNull(),
    /** Null while the first call is still in flight. */
    response: jsonb(),
    createdAt: tstz().notNull().defaultNow(),
    completedAt: tstz(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);
