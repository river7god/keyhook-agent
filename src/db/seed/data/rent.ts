import type { arrearsCases, messages, rentLedger } from '@/db/schema';
import { addDays, nzDate } from '@/lib/time';
import { PROPERTY, seedId } from '../ids';
import { currentTenancyFor, primaryTenantFor, tenancyRows } from './tenancies';

type LedgerRow = (typeof rentLedger)['$inferInsert'];

/**
 * Eight weeks of rent per current tenancy, relative to `now` (deterministic for a given date).
 * Everyone has paid on time except:
 *   Kelburn — this week's rent (due 5 days ago) unpaid → the first sweep opens a case.
 *   Karori  — two weeks unpaid (oldest due 12 days ago), reminded 4 days ago → the next sweep
 *             drafts the 14-day notice for PM approval.
 */
const UNPAID: Record<string, number> = { [PROPERTY.kelburn]: 1, [PROPERTY.karori]: 2 };
const LAST_DUE_DAYS_AGO = 5;

export function rentLedgerRows(now: Date): LedgerRow[] {
  const today = nzDate(now);
  const rows: LedgerRow[] = [];
  for (const t of tenancyRows) {
    if (!t.rentCents || !t.rentFrequency) continue;
    const step = t.rentFrequency === 'weekly' ? 7 : 14;
    const count = t.rentFrequency === 'weekly' ? 8 : 4;
    const unpaid = UNPAID[t.propertyId] ?? 0;
    for (let k = count - 1; k >= 0; k--) {
      const due = addDays(today, -(LAST_DUE_DAYS_AGO + k * step));
      rows.push({
        organizationId: t.organizationId,
        tenancyId: t.id,
        kind: 'charge',
        amountCents: t.rentCents,
        effectiveDate: due,
        reference: 'Rent',
      });
      if (k >= unpaid) {
        rows.push({
          organizationId: t.organizationId,
          tenancyId: t.id,
          kind: 'payment',
          amountCents: t.rentCents,
          effectiveDate: due,
          reference: 'Automatic payment',
        });
      }
    }
  }
  return rows;
}

const karori = currentTenancyFor(PROPERTY.karori);
export const KARORI_ARREARS_CASE = seedId('arrearsCase', 1);

export function arrearsCaseRows(now: Date): (typeof arrearsCases)['$inferInsert'][] {
  const today = nzDate(now);
  return [
    {
      id: KARORI_ARREARS_CASE,
      organizationId: karori.organizationId,
      tenancyId: karori.id,
      tenantId: primaryTenantFor(karori.id),
      state: 'REMINDED',
      balanceCents: 2 * (karori.rentCents ?? 0),
      oldestUnpaidDate: addDays(today, -(LAST_DUE_DAYS_AGO + 7)),
      remindersSent: 1,
      lastReminderAt: new Date(now.getTime() - 4 * 86_400_000),
      createdAt: new Date(now.getTime() - 4 * 86_400_000),
      updatedAt: new Date(now.getTime() - 4 * 86_400_000),
    },
  ];
}

export function arrearsMessageRows(now: Date): (typeof messages)['$inferInsert'][] {
  const at = new Date(now.getTime() - 4 * 86_400_000);
  return [
    {
      organizationId: karori.organizationId,
      arrearsCaseId: KARORI_ARREARS_CASE,
      direction: 'outbound',
      senderType: 'agent',
      recipientType: 'tenant',
      recipientId: primaryTenantFor(karori.id),
      body: "Kia ora, a quick note that this week's rent of $680.00 hasn't come through yet. Could you let us know when you'll be able to pay? If things are tight at the moment, just tell us — we're happy to work something out.",
      status: 'sent',
      idempotencyKey: `seed:arrears:${KARORI_ARREARS_CASE}:reminder1`,
      createdAt: at,
      updatedAt: at,
    },
  ];
}
