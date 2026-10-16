import type { DeliveryResult, MessagingAdapter, OutboundMessage } from './types';

/**
 * Dev/test adapter: never leaves the process. The simulator UI reads delivered messages from the
 * `messages` table; `sent` here exists so tests can assert on delivery attempts.
 */
export class MockOutboxAdapter implements MessagingAdapter {
  readonly name = 'mock-outbox';
  readonly sent = new Map<string, OutboundMessage>();

  send(message: OutboundMessage): Promise<DeliveryResult> {
    // Idempotent: a repeated key is a no-op that returns the same result.
    if (!this.sent.has(message.idempotencyKey)) this.sent.set(message.idempotencyKey, message);
    return Promise.resolve({ externalId: `mock:${message.idempotencyKey}` });
  }
}
