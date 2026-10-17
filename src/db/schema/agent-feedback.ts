import { foreignKey, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, organizationId, tstz } from './columns';
import { feedbackKindEnum, feedbackSourceEnum } from './enums';
import { jobs } from './jobs';
import { organizations, propertyManagers } from './organizations';

export interface FeedbackExpected {
  urgency?: 'emergency' | 'urgent' | 'routine';
  trade?: 'plumbing' | 'electrical' | 'heating' | 'handyman' | 'locksmith' | 'other';
  escalate?: boolean;
}

/**
 * A PM's correction of the agent — the labelled data for the improvement loop
 * (decisions.md "PM corrections become eval scenarios"). `agentSaw` snapshots what the agent
 * decided at the time, so the label stays meaningful after the job changes.
 */
export const agentFeedback = pgTable(
  'agent_feedback',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    jobId: uuid().notNull(),
    propertyManagerId: uuid(),
    source: feedbackSourceEnum().notNull(),
    kind: feedbackKindEnum().notNull(),
    expected: jsonb().$type<FeedbackExpected>().notNull(),
    agentSaw: jsonb().$type<FeedbackExpected & { state: string }>().notNull(),
    note: text(),
    /** Set when `pnpm eval:harvest` turned this into a scenario file. */
    harvestedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index('agent_feedback_org_created_idx').on(t.organizationId, t.createdAt),
    foreignKey({
      name: 'agent_feedback_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
    foreignKey({
      name: 'agent_feedback_pm_fk',
      columns: [t.organizationId, t.propertyManagerId],
      foreignColumns: [propertyManagers.organizationId, propertyManagers.id],
    }),
  ],
);
