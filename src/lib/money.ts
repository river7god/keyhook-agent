/**
 * Money is always integer cents, NZD (CLAUDE.md rule 6).
 * These helpers are the only place cents are converted for display or parsing.
 */

export type Cents = number;

export function assertCents(value: number): asserts value is Cents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Expected a non-negative integer number of cents, got ${String(value)}`);
  }
}

const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });

/** 123450 → "$1,234.50" */
export function formatNzd(cents: Cents): string {
  assertCents(cents);
  return nzd.format(cents / 100);
}

/** "1,234.50" | "$1234.5" | "1234" → 123450. Rejects more than 2 decimal places. */
export function parseNzdToCents(input: string): Cents {
  const cleaned = input.trim().replace(/^\$/, '').replaceAll(',', '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new RangeError(`Not a valid NZD amount: "${input}"`);
  const dollars = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = dollars * 100 + fraction;
  assertCents(cents);
  return cents;
}
