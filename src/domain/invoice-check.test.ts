import { describe, expect, it } from 'vitest';
import { checkInvoice } from './invoice-check';

describe('checkInvoice (5 % or NZ$50, whichever is larger)', () => {
  it.each([
    [18_500, 18_500, 'matched'], // exact
    [15_000, 18_500, 'matched'], // under
    [23_500, 18_500, 'matched'], // +$50 on $185 (5 % would be $9.25)
    [23_501, 18_500, 'needs_review'],
    [210_000, 200_000, 'matched'], // +5 % on $2,000 = $100
    [210_001, 200_000, 'needs_review'],
  ] as const)('invoice %i vs approved %i → %s', (amount, approved, status) => {
    expect(checkInvoice(amount, approved).status).toBe(status);
  });

  it('needs review when nothing was approved', () => {
    expect(checkInvoice(10_000, null)).toMatchObject({
      status: 'needs_review',
      differenceCents: null,
    });
  });
});
