import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps, tstz } from './columns';
import { actorTypeEnum, followUpKindEnum, followUpStatusEnum } from './enums';
import { jobs } from './jobs';
import { organizations } from './organizations';

export const followUps = pgTable(
  'follow_ups',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    jobId: uuid().notNull(),
    targetType: actorTypeEnum().notNull(),
    targetId: uuid().notNull(),
    kind: followUpKindEnum().notNull(),
    attempt: integer().notNull().default(1),
    dueAt: tstz().notNull(),
    status: followUpStatusEnum().notNull().default('scheduled'),
    ...timestamps,
  },
  (t) => [
    index('follow_ups_status_due_idx').on(t.status, t.dueAt),
    index('follow_ups_org_job_idx').on(t.organizationId, t.jobId),
    // At most one pending follow-up per job: the wait the job is currently in.
    uniqueIndex('follow_ups_one_scheduled_per_job_uq')
      .on(t.jobId)
      .where(sql`${t.status} = 'scheduled'`),
    check('follow_ups_attempt_positive', sql`${t.attempt} >= 1`),
    foreignKey({
      name: 'follow_ups_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
  ],
);
