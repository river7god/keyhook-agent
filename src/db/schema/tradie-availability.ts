import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, uuid } from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps, tstz } from './columns';
import { jobs } from './jobs';
import { organizations } from './organizations';
import { tradies } from './tradies';

/** Free slots a tradie has offered. schedule_visit consumes one by setting booked_job_id. */
export const tradieAvailability = pgTable(
  'tradie_availability',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    tradieId: uuid().notNull(),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    bookedJobId: uuid(),
    ...timestamps,
  },
  (t) => [
    index('tradie_availability_tradie_starts_idx').on(t.organizationId, t.tradieId, t.startsAt),
    check('tradie_availability_window_valid', sql`${t.endsAt} > ${t.startsAt}`),
    foreignKey({
      name: 'tradie_availability_tradie_fk',
      columns: [t.organizationId, t.tradieId],
      foreignColumns: [tradies.organizationId, tradies.id],
    }),
    foreignKey({
      name: 'tradie_availability_job_fk',
      columns: [t.organizationId, t.bookedJobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
  ],
);
