import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps } from './columns';
import {
  actorTypeEnum,
  messageChannelEnum,
  messageDirectionEnum,
  messageStatusEnum,
} from './enums';
import { arrearsCases } from './arrears';
import { jobs } from './jobs';
import { organizations } from './organizations';

/**
 * Inbound messages and the outbound outbox share one table so a job's conversation is one query.
 * Participants are polymorphic (type + id) — no FK on sender/recipient by design.
 * `body` from tenants/tradies is UNTRUSTED (CLAUDE.md rule 5).
 */
export const messages = pgTable(
  'messages',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    jobId: uuid(),
    /** Arrears conversations (spec §12 R8). A message belongs to at most one of job / case. */
    arrearsCaseId: uuid(),
    direction: messageDirectionEnum().notNull(),
    channel: messageChannelEnum().notNull().default('simulator'),
    senderType: actorTypeEnum().notNull(),
    senderId: uuid(),
    recipientType: actorTypeEnum().notNull(),
    recipientId: uuid(),
    body: text().notNull(),
    status: messageStatusEnum().notNull(),
    idempotencyKey: text(),
    ...timestamps,
  },
  (t) => [
    unique('messages_org_idempotency_uq').on(t.organizationId, t.idempotencyKey),
    index('messages_org_job_created_idx').on(t.organizationId, t.jobId, t.createdAt),
    check(
      'messages_outbound_has_idempotency_key',
      sql`${t.direction} = 'inbound' OR ${t.idempotencyKey} IS NOT NULL`,
    ),
    index('messages_org_arrears_created_idx').on(t.organizationId, t.arrearsCaseId, t.createdAt),
    check('messages_one_subject', sql`num_nonnulls(${t.jobId}, ${t.arrearsCaseId}) <= 1`),
    foreignKey({
      name: 'messages_arrears_case_fk',
      columns: [t.organizationId, t.arrearsCaseId],
      foreignColumns: [arrearsCases.organizationId, arrearsCases.id],
    }),
    foreignKey({
      name: 'messages_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
  ],
);
