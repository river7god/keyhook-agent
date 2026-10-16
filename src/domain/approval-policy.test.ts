import { describe, expect, it } from 'vitest';
import { decideApproval, effectivePmLimitCents, type ApprovalLimits } from './approval-policy';

const limits = (over: Partial<ApprovalLimits> = {}): ApprovalLimits => ({
  pmLimitCents: null,
  orgDefaultPmLimitCents: 30_000,
  ownerLimitCents: 100_000,
  ...over,
});

describe('effectivePmLimitCents', () => {
  it('falls back to the org default when the PM has no personal limit', () => {
    expect(effectivePmLimitCents(limits())).toBe(30_000);
  });

  it('uses the PM limit when set, even if lower than the org default', () => {
    expect(effectivePmLimitCents(limits({ pmLimitCents: 10_000 }))).toBe(10_000);
  });

  it('is capped by the owner limit', () => {
    expect(effectivePmLimitCents(limits({ pmLimitCents: 500_000 }))).toBe(100_000);
    expect(effectivePmLimitCents(limits({ ownerLimitCents: 20_000 }))).toBe(20_000);
  });

  it('treats a PM limit of 0 as "approve everything manually", not as unset', () => {
    expect(effectivePmLimitCents(limits({ pmLimitCents: 0 }))).toBe(0);
  });
});

describe('decideApproval', () => {
  it.each([
    [0, 'auto_approve'],
    [30_000, 'auto_approve'], // boundary: ≤ effective
    [30_001, 'pm_approval'],
    [100_000, 'pm_approval'], // boundary: ≤ owner
    [100_001, 'escalate'],
  ] as const)('estimate %i cents → %s', (estimate, kind) => {
    expect(decideApproval(estimate, limits()).kind).toBe(kind);
  });

  it('skips the PM tier when the owner limit is below the PM limit', () => {
    const l = limits({ pmLimitCents: 50_000, ownerLimitCents: 20_000 });
    expect(decideApproval(20_000, l).kind).toBe('auto_approve');
    expect(decideApproval(20_001, l).kind).toBe('escalate');
  });

  it('rejects non-integer or negative amounts', () => {
    expect(() => decideApproval(100.5, limits())).toThrow(RangeError);
    expect(() => decideApproval(-1, limits())).toThrow(RangeError);
  });
});
