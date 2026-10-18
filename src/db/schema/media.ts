import {
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, organizationId, tstz } from './columns';
import { jobs } from './jobs';
import { messages } from './messages';
import { organizations } from './organizations';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export interface MediaAnalysis {
  showsIssue: boolean;
  quality: 'good' | 'blurry' | 'too_dark' | 'too_far' | 'irrelevant';
  retakeAdvice: string | null;
  observations: string;
  safetyCues: string[];
  label: { make: string | null; model: string | null; serial: string | null } | null;
  promptInjection: boolean;
  documentKind?: 'invoice' | 'quote' | null;
  documentTotalNzd?: string | null;
  documentGst?: 'included' | 'excluded' | 'unknown';
  documentReference?: string | null;
}

/**
 * Photos attached to inbound messages (spec §12 R1). Bytes live in Postgres for now behind
 * src/domain/media-store.ts — swappable for object storage. Untrusted input; RLS-scoped;
 * deleted after expires_at (180 days).
 */
export const media = pgTable(
  'media',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    jobId: uuid().notNull(),
    messageId: uuid().notNull(),
    mime: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    sizeBytes: integer().notNull(),
    sha256: text().notNull(),
    bytes: bytea().notNull(),
    /** Null until analysed; { error } if analysis was unavailable. */
    analysis: jsonb().$type<MediaAnalysis | { unavailable: string }>(),
    analysedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
    expiresAt: tstz().notNull(),
  },
  (t) => [
    index('media_org_job_idx').on(t.organizationId, t.jobId, t.createdAt),
    index('media_expires_idx').on(t.expiresAt),
    foreignKey({
      name: 'media_job_fk',
      columns: [t.organizationId, t.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
    }),
    foreignKey({
      name: 'media_message_fk',
      columns: [t.messageId],
      foreignColumns: [messages.id],
    }).onDelete('cascade'),
  ],
);
