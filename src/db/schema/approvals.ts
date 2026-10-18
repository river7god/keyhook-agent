import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps, tstz } from './columns';
import { approvalKindEnum, approvalStatusEnum } from './enums';
import { arrearsCases } from './arrears';
import { jobs } from './jobs';
import { organizations } from './organizations';

/** The stored manager approval record required before any `approval`-level tool runs (rule 2). */
export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Exactly one of jobId / arrearsCaseId (spend approvals vs arrears notices). */
    jobId: uuid(),
    arrearsCaseId: uuid(),
    /** quote = the first approval; variation = extra cost reported after approval (spec §12 R2). */
    kind: approvalKindEnum().notNull().default('quote'),
    /** For variations: the approved total before this change. */
    previousAmountCents: integer(),
    amountCents: integer().notNull(),
    reason: text().notNull(),
    status: approvalStatusEnum().notNull().default('pending'),
    /** Plain PM identifier until auth exists (decisions.md). */
    decidedBy: text(),
    decidedAt: tstz(),
    decisionNote: text(),
    idempotencyKey: text().notNull(),
    ...timestamps,
  },
  (t) => [
    unique('approvals_org_idempotency_uq').on(t.organizationId, t.idempotencyKey),
    index('approvals_org_status_idx').on(t.organizationId, t.status),
    uniqueIndex('approvals_one_pending_per_job_uq')
      .on(t.jobId)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex('approvals_one_pending_per_arrears_uq')
      .on(t.arrearsCaseId)
      .where(sql`${t.status} = 'pending'`),
    check('approvals_one_subject', sql`num_nonnulls(${t.jobId}, ${t.arrearsCaseId}) = 1`),
    check('approvals_amount_nonneg', sql`${t.amountCents} >= 0`),
    check(
      'approvals_decision_recorded',
      sql`${t.status} NOT IN ('approved', 'rejected') OR (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: 'approvals_arrears_case_fk',
      columns: [t.organizationId, t.arrearsCaseId],
      foreignColumns: [arrearsCases.organizationId, arrearsCases.id],
    }),
    foreignKey({
      name: 'approvals_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
  ],
);
