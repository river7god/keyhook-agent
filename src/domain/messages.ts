import { and, asc, eq } from 'drizzle-orm';
import { getMessagingAdapter } from '@/adapters/messaging';
import type { DbOrTx } from '@/db/client';
import { messages, type ActorType } from '@/db/schema';
import { DomainError } from './errors';

export type Message = typeof messages.$inferSelect;

/** Inbound text from a tenant or tradie. Stored verbatim — it is untrusted data (rule 5). */
export async function recordInbound(
  tx: DbOrTx,
  args: {
    organizationId: string;
    jobId: string;
    senderType: Extract<ActorType, 'tenant' | 'tradie'>;
    senderId: string;
    body: string;
  },
): Promise<Message> {
  const [row] = await tx
    .insert(messages)
    .values({
      organizationId: args.organizationId,
      jobId: args.jobId,
      direction: 'inbound',
      senderType: args.senderType,
      senderId: args.senderId,
      recipientType: 'agent',
      body: args.body,
      status: 'received',
    })
    .returning();
  if (!row) throw new Error('message insert failed');
  return row;
}

/**
 * Write an outbound message to the outbox (idempotent per key). Delivery happens after the
 * transaction commits via `deliverQueued`, so a rolled-back step never sends anything.
 */
export async function queueOutbound(
  tx: DbOrTx,
  args: {
    organizationId: string;
    jobId: string;
    recipientType: Extract<ActorType, 'tenant' | 'tradie' | 'pm'>;
    recipientId: string;
    body: string;
    idempotencyKey: string;
  },
): Promise<Message> {
  await tx
    .insert(messages)
    .values({
      organizationId: args.organizationId,
      jobId: args.jobId,
      direction: 'outbound',
      senderType: 'agent',
      recipientType: args.recipientType,
      recipientId: args.recipientId,
      body: args.body,
      status: 'queued',
      idempotencyKey: args.idempotencyKey,
    })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, args.organizationId),
        eq(messages.idempotencyKey, args.idempotencyKey),
      ),
    );
  if (!row) throw new DomainError('CONFLICT', 'Outbound message missing after insert');
  return row;
}

/** Hand queued messages for a job to the messaging adapter (mock outbox in dev — rule 7). */
export async function deliverQueued(db: DbOrTx, organizationId: string, jobId: string) {
  const queued = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.jobId, jobId),
        eq(messages.status, 'queued'),
      ),
    )
    .orderBy(asc(messages.createdAt));
  const adapter = getMessagingAdapter();
  for (const m of queued) {
    if (!m.idempotencyKey || !m.recipientId) continue;
    try {
      await adapter.send({
        organizationId,
        jobId,
        recipientType: m.recipientType,
        recipientId: m.recipientId,
        body: m.body,
        idempotencyKey: m.idempotencyKey,
      });
      await db.update(messages).set({ status: 'sent' }).where(eq(messages.id, m.id));
    } catch {
      await db.update(messages).set({ status: 'failed' }).where(eq(messages.id, m.id));
    }
  }
  return queued.length;
}

export async function listJobMessages(db: DbOrTx, organizationId: string, jobId: string) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.jobId, jobId)))
    .orderBy(asc(messages.createdAt));
}
