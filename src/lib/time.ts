/**
 * Dates are stored in UTC and displayed in Pacific/Auckland (CLAUDE.md rule 6).
 * Uses Intl only — no date library needed for display.
 */

export const DISPLAY_TIME_ZONE = 'Pacific/Auckland';

const dateTimeFormat = new Intl.DateTimeFormat('en-NZ', {
  timeZone: DISPLAY_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateFormat = new Intl.DateTimeFormat('en-NZ', {
  timeZone: DISPLAY_TIME_ZONE,
  dateStyle: 'medium',
});

/** Format a UTC instant for display in NZ local time (handles NZST/NZDT). */
export function formatNzDateTime(instant: Date, timeZone: string = DISPLAY_TIME_ZONE): string {
  return timeZone === DISPLAY_TIME_ZONE
    ? dateTimeFormat.format(instant)
    : new Intl.DateTimeFormat('en-NZ', {
        timeZone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(instant);
}

export function formatNzDate(instant: Date): string {
  return dateFormat.format(instant);
}
