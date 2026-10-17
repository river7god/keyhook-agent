import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizationId, tstz } from './columns';
import { jobs } from './jobs';
import { organizations } from './organizations';

/**
 * One row per Claude API request — the basis for cost-per-job and latency metrics (spec §10).
 * Cost is the API's own currency (USD), stored as integer micro-dollars; business money stays
 * NZD cents (rule 6). Null cost = model not in the local price table.
 */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: organizationId().references(() => organizations.id),
    jobId: uuid(),
    /** e.g. "triage", "act.triaged", "interpret.awaiting_quote", "compose". */
    step: text().notNull(),
    requestedModel: text().notNull(),
    /** Model that produced the final answer (differs when a refusal fallback ran). */
    servedModel: text(),
    stopReason: text(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadInputTokens: integer().notNull().default(0),
    cacheCreationInputTokens: integer().notNull().default(0),
    costUsdMicros: integer(),
    latencyMs: integer().notNull(),
    requestId: text(),
    error: jsonb(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index('llm_calls_org_job_idx').on(t.organizationId, t.jobId, t.createdAt),
    foreignKey({
      name: 'llm_calls_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
  ],
);
