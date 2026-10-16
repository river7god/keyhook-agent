import { describe, expect, it } from 'vitest';
import { MockOutboxAdapter } from './mock-outbox';

describe('MockOutboxAdapter', () => {
  it('is idempotent per key', async () => {
    const outbox = new MockOutboxAdapter();
    const msg = {
      organizationId: 'org',
      jobId: null,
      recipientType: 'tenant' as const,
      recipientId: 't1',
      body: 'Hi',
      idempotencyKey: 'k1',
    };
    const a = await outbox.send(msg);
    const b = await outbox.send({ ...msg, body: 'changed' });
    expect(a).toEqual(b);
    expect(outbox.sent.size).toBe(1);
    expect(outbox.sent.get('k1')?.body).toBe('Hi');
  });
});
