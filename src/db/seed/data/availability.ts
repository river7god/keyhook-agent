import type { tradieAvailability } from '@/db/schema';
import { zonedDateParts, zonedToUtc } from '@/lib/time';
import { tradieRows } from './tradies';

type Row = (typeof tradieAvailability)['$inferInsert'];

const SLOTS = [
  { start: 8, end: 12 },
  { start: 13, end: 17 },
];

/**
 * Free slots for the next 10 NZ weekdays from `from`. Unlike the rest of the seed this is relative
 * to seed time (availability in the past is useless). Each tradie gets a different, deterministic
 * pattern of gaps so ranking by availability is meaningful.
 */
export function availabilityRows(from: Date): Row[] {
  const rows: Row[] = [];
  const active = tradieRows.filter((t) => t.active !== false);
  active.forEach((tradie, tradieIndex) => {
    let weekdayCount = 0;
    for (let dayOffset = 1; weekdayCount < 10; dayOffset++) {
      const day = zonedDateParts(new Date(from.getTime() + dayOffset * 86_400_000));
      if (day.weekday === 0 || day.weekday === 6) continue;
      weekdayCount++;
      SLOTS.forEach((slot, slotIndex) => {
        // Busier tradies (by index) have fewer free slots; first ones are free sooner.
        if ((weekdayCount + slotIndex + tradieIndex) % (2 + (tradieIndex % 3)) !== 0) return;
        rows.push({
          organizationId: tradie.organizationId,
          tradieId: tradie.id as string,
          startsAt: zonedToUtc({ ...day, hour: slot.start }),
          endsAt: zonedToUtc({ ...day, hour: slot.end }),
        });
      });
    }
  });
  return rows;
}
