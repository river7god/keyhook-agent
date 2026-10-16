import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps } from './columns';
import {
  actorTypeEnum,
  messageChannelEnum,
  messageDirectionEnum,
  messageStatusEnum,
} from './enums';
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
    foreignKey({
      name: 'messages_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
  ],
);
