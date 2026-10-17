import { describe, expect, it } from 'vitest';
import {
  formatNzDate,
  formatNzDateTime,
  outsideQuietHours,
  zonedDateParts,
  zonedToUtc,
} from './time';

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

describe('zonedToUtc', () => {
  it('converts NZST wall time (UTC+12)', () => {
    expect(zonedToUtc({ year: 2026, month: 7, day: 1, hour: 9 }).toISOString()).toBe(
      '2026-06-30T21:00:00.000Z',
    );
  });

  it('converts NZDT wall time (UTC+13)', () => {
    expect(zonedToUtc({ year: 2026, month: 12, day: 1, hour: 9 }).toISOString()).toBe(
      '2026-11-30T20:00:00.000Z',
    );
  });

  it('round-trips through zonedDateParts', () => {
    const utc = zonedToUtc({ year: 2026, month: 10, day: 19, hour: 8 });
    expect(zonedDateParts(utc)).toMatchObject({ year: 2026, month: 10, day: 19, weekday: 1 });
  });
});

describe('outsideQuietHours', () => {
  const quiet = { startHour: 20, endHour: 8 };
  it('leaves daytime alone', () => {
    const noon = zonedToUtc({ year: 2026, month: 10, day: 19, hour: 12 });
    expect(outsideQuietHours(noon, quiet)).toEqual(noon);
  });
  it('moves late evening to 8am next day', () => {
    const late = zonedToUtc({ year: 2026, month: 10, day: 19, hour: 22 });
    expect(outsideQuietHours(late, quiet)).toEqual(
      zonedToUtc({ year: 2026, month: 10, day: 20, hour: 8 }),
    );
  });
  it('moves early morning to 8am same day', () => {
    const early = zonedToUtc({ year: 2026, month: 10, day: 20, hour: 3 });
    expect(outsideQuietHours(early, quiet)).toEqual(
      zonedToUtc({ year: 2026, month: 10, day: 20, hour: 8 }),
    );
  });
});
