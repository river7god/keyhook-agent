import { bigint, foreignKey, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { organizationId, tstz } from './columns';
import { actorTypeEnum, auditOutcomeEnum } from './enums';
import { jobs } from './jobs';
import { organizations } from './organizations';

/**
 * Append-only (rule 4). A trigger in migration 0001 rejects UPDATE and DELETE.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: organizationId().references(() => organizations.id),
    jobId: uuid(),
    actorType: actorTypeEnum().notNull(),
    actorId: text(),
    /** Tool name or event, e.g. "send_message", "job.transition". */
    action: text().notNull(),
    /** The "why". */
    reason: text(),
    input: jsonb(),
    output: jsonb(),
    outcome: auditOutcomeEnum().notNull(),
    idempotencyKey: text(),
    /** Langfuse trace id (M4). */
    traceId: text(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_job_created_idx').on(t.organizationId, t.jobId, t.createdAt),
    index('audit_log_org_created_idx').on(t.organizationId, t.createdAt),
    foreignKey({
      name: 'audit_log_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
  ],
);
