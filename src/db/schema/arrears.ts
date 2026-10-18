import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps, tstz } from './columns';
import { arrearsStateEnum, ledgerKindEnum, rentFrequencyEnum } from './enums';
import { organizations } from './organizations';
import { tenancies, tenants } from './tenancies';

/**
 * Rent ledger (spec §12 R8). In production this mirrors the agency's trust-accounting ledger
 * (Keyhook financials); here it is seeded. Amounts are positive integer cents NZD; the kind says
 * which way the money moved. Dates are NZ calendar dates.
 */
export const rentLedger = pgTable(
  'rent_ledger',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    tenancyId: uuid().notNull(),
    kind: ledgerKindEnum().notNull(),
    amountCents: integer().notNull(),
    effectiveDate: date({ mode: 'string' }).notNull(),
    reference: text(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index('rent_ledger_org_tenancy_date_idx').on(t.organizationId, t.tenancyId, t.effectiveDate),
    check('rent_ledger_amount_positive', sql`${t.amountCents} > 0`),
    foreignKey({
      name: 'rent_ledger_tenancy_fk',
      columns: [t.organizationId, t.tenancyId],
      foreignColumns: [tenancies.organizationId, tenancies.id],
    }),
  ],
);

/**
 * One arrears case per tenancy at a time. The arrears state machine
 * (src/workflows/arrears-state-machine.ts) owns `state`; promise fields describe the tenant's
 * current commitment (a one-off promise, or the next instalment of a plan).
 */
export const arrearsCases = pgTable(
  'arrears_cases',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    tenancyId: uuid().notNull(),
    /** Primary contact the agent talks to. */
    tenantId: uuid().notNull(),
    state: arrearsStateEnum().notNull().default('OPEN'),
    stateBeforeEscalation: arrearsStateEnum(),
    /** Balance and oldest unpaid due date at the last evaluation. */
    balanceCents: integer().notNull(),
    oldestUnpaidDate: date({ mode: 'string' }).notNull(),
    remindersSent: integer().notNull().default(0),
    lastReminderAt: tstz(),
    promiseAmountCents: integer(),
    promiseDate: date({ mode: 'string' }),
    promiseMadeOn: date({ mode: 'string' }),
    planInstalmentCents: integer(),
    planFrequency: rentFrequencyEnum(),
    noticeSentAt: tstz(),
    remedyByDate: date({ mode: 'string' }),
    escalationReason: text(),
    version: integer().notNull().default(1),
    closedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('arrears_cases_org_id_uq').on(t.organizationId, t.id),
    uniqueIndex('arrears_cases_one_open_uq')
      .on(t.organizationId, t.tenancyId)
      .where(sql`${t.state} NOT IN ('RESOLVED', 'CLOSED')`),
    index('arrears_cases_org_state_idx').on(t.organizationId, t.state),
    check('arrears_cases_balance_nonneg', sql`${t.balanceCents} >= 0`),
    foreignKey({
      name: 'arrears_cases_tenancy_fk',
      columns: [t.organizationId, t.tenancyId],
      foreignColumns: [tenancies.organizationId, tenancies.id],
    }),
    foreignKey({
      name: 'arrears_cases_tenant_fk',
      columns: [t.organizationId, t.tenantId],
      foreignColumns: [tenants.organizationId, tenants.id],
    }),
  ],
);
