import { MockOutboxAdapter } from './mock-outbox';
import type { MessagingAdapter } from './types';

export type { MessagingAdapter, OutboundMessage, DeliveryResult } from './types';

let adapter: MessagingAdapter | undefined;

/** Only the mock exists until real SMS/email adapters are built (CLAUDE.md rule 7). */
export function getMessagingAdapter(): MessagingAdapter {
  adapter ??= new MockOutboxAdapter();
  return adapter;
}
