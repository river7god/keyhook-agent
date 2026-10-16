import { describe, expect, it } from 'vitest';
import { assertCents, formatNzd, parseNzdToCents } from './money';

describe('money', () => {
  it('formats cents as NZD', () => {
    expect(formatNzd(0)).toBe('$0.00');
    expect(formatNzd(123450)).toBe('$1,234.50');
  });

  it('parses common NZD inputs to cents', () => {
    expect(parseNzdToCents('1,234.50')).toBe(123450);
    expect(parseNzdToCents('$1234.5')).toBe(123450);
    expect(parseNzdToCents('80')).toBe(8000);
  });

  it('rejects fractional cents, negatives and junk', () => {
    expect(() => parseNzdToCents('1.234')).toThrow(RangeError);
    expect(() => parseNzdToCents('-5')).toThrow(RangeError);
    expect(() => parseNzdToCents('abc')).toThrow(RangeError);
    expect(() => {
      assertCents(10.5);
    }).toThrow(RangeError);
  });
});
