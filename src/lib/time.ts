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

const timeFormat = new Intl.DateTimeFormat('en-NZ', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** "23:28:05" in NZ local time — for dense, same-day lists such as the agent trace. */
export function formatNzTime(instant: Date): string {
  return timeFormat.format(instant);
}

export function formatNzDate(instant: Date): string {
  return dateFormat.format(instant);
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +780 for NZDT). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Wall-clock time in `timeZone` → UTC instant. DST-safe for non-ambiguous times. */
export function zonedToUtc(
  local: { year: number; month: number; day: number; hour: number; minute?: number },
  timeZone: string = DISPLAY_TIME_ZONE,
): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute ?? 0);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * 60_000);
}

/** Calendar date (y/m/d) and weekday (0=Sun) of an instant in `timeZone`. */
export function zonedDateParts(instant: Date, timeZone: string = DISPLAY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday,
  };
}

/** NZ local hour (0–23) of an instant. */
export function zonedHour(instant: Date, timeZone: string = DISPLAY_TIME_ZONE): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(
      instant,
    ),
  );
}

/**
 * Move `instant` out of quiet hours (e.g. 20:00–08:00 local) to the next `endHour`.
 * Handles windows that wrap midnight.
 */
export function outsideQuietHours(
  instant: Date,
  quiet: { startHour: number; endHour: number },
  timeZone: string = DISPLAY_TIME_ZONE,
): Date {
  const h = zonedHour(instant, timeZone);
  const wraps = quiet.startHour > quiet.endHour;
  const inQuiet = wraps
    ? h >= quiet.startHour || h < quiet.endHour
    : h >= quiet.startHour && h < quiet.endHour;
  if (!inQuiet) return instant;
  const day = zonedDateParts(instant, timeZone);
  const sameDayEnd = zonedToUtc({ ...day, hour: quiet.endHour }, timeZone);
  if (sameDayEnd > instant) return sameDayEnd;
  const next = zonedDateParts(new Date(instant.getTime() + 24 * 3_600_000), timeZone);
  return zonedToUtc({ ...next, hour: quiet.endHour }, timeZone);
}

/** NZ calendar date of an instant as YYYY-MM-DD (rent due dates are calendar dates). */
export function nzDate(instant: Date, timeZone: string = DISPLAY_TIME_ZONE): string {
  const p = zonedDateParts(instant, timeZone);
  return `${String(p.year)}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** YYYY-MM-DD plus n calendar days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Mon 20 Oct 2026" for a YYYY-MM-DD calendar date. */
export function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}
