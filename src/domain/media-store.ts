import { createHash } from 'node:crypto';
import { and, asc, eq, isNull, lt } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { media, type MediaAnalysis } from '@/db/schema';
import { precheckImage } from '@/lib/image-header';

/** spec §12 R1: media is kept 180 days. */
export const MEDIA_RETENTION_DAYS = 180;
export const MAX_IMAGES_PER_MESSAGE = 5;

export interface Rejected {
  index: number;
  reason: string;
}

/**
 * Store images attached to an inbound message after cheap code checks (type, size, resolution).
 * Postgres-backed; the functions here are the seam for moving bytes to object storage later.
 */
export async function saveMessageImages(
  db: DbOrTx,
  args: { organizationId: string; jobId: string; messageId: string; files: Buffer[]; now: Date },
): Promise<{ saved: string[]; rejected: Rejected[] }> {
  const saved: string[] = [];
  const rejected: Rejected[] = [];
  const expiresAt = new Date(args.now.getTime() + MEDIA_RETENTION_DAYS * 86_400_000);
  for (const [index, buf] of args.files.entries()) {
    if (index >= MAX_IMAGES_PER_MESSAGE) {
      rejected.push({ index, reason: `At most ${MAX_IMAGES_PER_MESSAGE} photos per message` });
      continue;
    }
    const check = precheckImage(buf);
    if (!check.ok) {
      rejected.push({ index, reason: check.reason });
      continue;
    }
    const [row] = await db
      .insert(media)
      .values({
        organizationId: args.organizationId,
        jobId: args.jobId,
        messageId: args.messageId,
        mime: check.info.mime,
        width: check.info.width,
        height: check.info.height,
        sizeBytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'),
        bytes: buf,
        expiresAt,
      })
      .returning({ id: media.id });
    if (row) saved.push(row.id);
  }
  return { saved, rejected };
}

const meta = {
  id: media.id,
  jobId: media.jobId,
  messageId: media.messageId,
  mime: media.mime,
  width: media.width,
  height: media.height,
  sizeBytes: media.sizeBytes,
  analysis: media.analysis,
  createdAt: media.createdAt,
};

export function listJobMedia(db: DbOrTx, organizationId: string, jobId: string) {
  return db
    .select(meta)
    .from(media)
    .where(and(eq(media.organizationId, organizationId), eq(media.jobId, jobId)))
    .orderBy(asc(media.createdAt));
}

/** Images of one message that haven't been analysed yet (with bytes, for the vision step). */
export function unanalysedMessageMedia(db: DbOrTx, organizationId: string, messageId: string) {
  return db
    .select({ id: media.id, mime: media.mime, bytes: media.bytes })
    .from(media)
    .where(
      and(
        eq(media.organizationId, organizationId),
        eq(media.messageId, messageId),
        isNull(media.analysedAt),
      ),
    )
    .orderBy(asc(media.createdAt));
}

export async function getMediaBytes(db: DbOrTx, organizationId: string, id: string) {
  const [row] = await db
    .select({ mime: media.mime, bytes: media.bytes })
    .from(media)
    .where(and(eq(media.organizationId, organizationId), eq(media.id, id)));
  return row ?? null;
}

export async function saveAnalysis(
  db: DbOrTx,
  id: string,
  analysis: MediaAnalysis | { unavailable: string },
  now: Date,
): Promise<void> {
  await db.update(media).set({ analysis, analysedAt: now }).where(eq(media.id, id));
}

export async function purgeExpiredMedia(db: DbOrTx, now: Date): Promise<number> {
  const rows = await db.delete(media).where(lt(media.expiresAt, now)).returning({ id: media.id });
  return rows.length;
}
