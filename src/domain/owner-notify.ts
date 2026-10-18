import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { properties } from '@/db/schema';
import type { Job } from './jobs';
import { queueOutbound } from './messages';

/**
 * Keep the owner informed (spec §12 R5). v1: the PM still approves on the owner's behalf, so these
 * are notifications, not requests. Plain templates — owners get facts, not chat.
 */
export async function notifyOwner(
  tx: DbOrTx,
  job: Job,
  body: string,
  idempotencyKey: string,
): Promise<void> {
  const [p] = await tx
    .select({ ownerId: properties.ownerId, address: properties.addressLine1 })
    .from(properties)
    .where(
      and(eq(properties.organizationId, job.organizationId), eq(properties.id, job.propertyId)),
    );
  if (!p) return;
  await queueOutbound(tx, {
    organizationId: job.organizationId,
    jobId: job.id,
    recipientType: 'owner',
    recipientId: p.ownerId,
    body: `${p.address}: ${body}`,
    idempotencyKey,
  });
}
