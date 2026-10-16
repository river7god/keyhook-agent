import { describe, expect, it } from 'vitest';
import { formatNzDate, formatNzDateTime } from './time';

describe('time', () => {
  it('displays UTC instants in NZST (UTC+12) in winter', () => {
    // 2026-07-01T00:00Z → 12:00 pm, 1 Jul in Auckland
    const out = formatNzDateTime(new Date('2026-07-01T00:00:00Z'));
    expect(out).toMatch(/1 Jul 2026/);
    expect(out).toMatch(/12:00/);
  });

  it('displays UTC instants in NZDT (UTC+13) in summer', () => {
    // 2026-01-15T11:30Z → 12:30 am, 16 Jan in Auckland
    expect(formatNzDateTime(new Date('2026-01-15T11:30:00Z'))).toMatch(/16 Jan 2026.*12:30/);
    expect(formatNzDate(new Date('2026-01-15T11:30:00Z'))).toBe('16 Jan 2026');
  });
});
