import type { ActorType } from '@/db/schema';

export interface OutboundMessage {
  organizationId: string;
  jobId: string | null;
  recipientType: ActorType;
  recipientId: string;
  body: string;
  /** Required: adapters must be safe to call twice with the same key (rule 3). */
  idempotencyKey: string;
}

export interface DeliveryResult {
  /** Provider message id (mock: derived from the idempotency key). */
  externalId: string;
}

/**
 * Port for sending messages to tenants/tradies. The `messages` table is the outbox;
 * an adapter only performs delivery. Real SMS/email adapters arrive post-v1 (rule 7).
 */
export interface MessagingAdapter {
  readonly name: string;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}
