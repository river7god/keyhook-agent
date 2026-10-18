import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, organizationId, tstz } from './columns';
import { invoiceStatusEnum } from './enums';
import { jobs } from './jobs';
import { organizations } from './organizations';

/**
 * Supplier invoices checked against the approved amount (spec §12 R3). No payments — the check
 * only flags differences for a PM.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    jobId: uuid().notNull(),
    /** Inbound message (text) or media id (photo) the invoice came from. */
    sourceMessageId: uuid(),
    sourceMediaId: uuid(),
    reference: text(),
    amountCents: integer().notNull(),
    approvedCents: integer(),
    differenceCents: integer(),
    status: invoiceStatusEnum().notNull(),
    reason: text().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index('invoices_org_job_idx').on(t.organizationId, t.jobId),
    check('invoices_amount_nonneg', sql`${t.amountCents} >= 0`),
    foreignKey({
      name: 'invoices_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
  ],
);
