import { and, asc, desc, eq, gte, isNotNull, lte, notInArray, sum } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  approvals,
  arrearsCases,
  properties,
  rentLedger,
  tenancies,
  tenancyTenants,
  tenants,
  type ActorType,
} from '@/db/schema';
import { assertCents } from '@/lib/money';
import { daysBetween } from '@/lib/time';
import { ARREARS_TERMINAL, type ArrearsState } from '@/workflows/arrears-states';
import { checkArrearsTransition } from '@/workflows/arrears-state-machine';
import { writeAudit } from './audit';
import { DomainError } from './errors';

/**
 * Arrears data access (spec §12 R8). Balances are computed from the rent ledger, never stored as
 * the source of truth: the case keeps the last evaluated balance for display and audit.
 */
export type ArrearsCase = typeof arrearsCases.$inferSelect;
type CasePatch = Partial<
  Pick<
    ArrearsCase,
    | 'balanceCents'
    | 'oldestUnpaidDate'
    | 'remindersSent'
    | 'lastReminderAt'
    | 'promiseAmountCents'
    | 'promiseDate'
    | 'promiseMadeOn'
    | 'planInstalmentCents'
    | 'planFrequency'
    | 'noticeSentAt'
    | 'remedyByDate'
    | 'escalationReason'
  >
>;

export interface LedgerPosition {
  balanceCents: number;
  /** Due date of the oldest charge not fully covered by payments (FIFO); null when paid up. */
  oldestUnpaidDate: string | null;
  daysOverdue: number;
}

/** Balance as at an NZ calendar date: charges due on or before it minus all payments to date. */
export async function ledgerPosition(
  db: DbOrTx,
  organizationId: string,
  tenancyId: string,
  asOf: string,
): Promise<LedgerPosition> {
  const rows = await db
    .select({
      kind: rentLedger.kind,
      amountCents: rentLedger.amountCents,
      effectiveDate: rentLedger.effectiveDate,
    })
    .from(rentLedger)
    .where(
      and(
        eq(rentLedger.organizationId, organizationId),
        eq(rentLedger.tenancyId, tenancyId),
        lte(rentLedger.effectiveDate, asOf),
      ),
    )
    .orderBy(asc(rentLedger.effectiveDate));
  let paid = rows.filter((r) => r.kind === 'payment').reduce((n, r) => n + r.amountCents, 0);
  let balance = -paid;
  let oldest: string | null = null;
  for (const c of rows.filter((r) => r.kind === 'charge')) {
    balance += c.amountCents;
    if (paid >= c.amountCents) {
      paid -= c.amountCents;
    } else {
      oldest ??= c.effectiveDate;
      paid = 0;
    }
  }
  const balanceCents = Math.max(0, balance);
  const oldestUnpaidDate = balanceCents > 0 ? oldest : null;
  return {
    balanceCents,
    oldestUnpaidDate,
    daysOverdue: oldestUnpaidDate ? Math.max(0, daysBetween(oldestUnpaidDate, asOf)) : 0,
  };
}

/** Payments received on or after a date (used to check a promise or plan instalment). */
export async function paymentsSince(
  db: DbOrTx,
  organizationId: string,
  tenancyId: string,
  fromDate: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sum(rentLedger.amountCents) })
    .from(rentLedger)
    .where(
      and(
        eq(rentLedger.organizationId, organizationId),
        eq(rentLedger.tenancyId, tenancyId),
        eq(rentLedger.kind, 'payment'),
        gte(rentLedger.effectiveDate, fromDate),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function recordPayment(
  tx: DbOrTx,
  args: {
    organizationId: string;
    tenancyId: string;
    amountCents: number;
    date: string;
    reference: string | null;
    actor: { type: ActorType; id: string | null };
  },
): Promise<void> {
  assertCents(args.amountCents);
  if (args.amountCents <= 0) throw new DomainError('VALIDATION', 'Payment must be positive');
  const [t] = await tx
    .select({ id: tenancies.id })
    .from(tenancies)
    .where(
      and(eq(tenancies.organizationId, args.organizationId), eq(tenancies.id, args.tenancyId)),
    );
  if (!t) throw new DomainError('NOT_FOUND', 'Tenancy not found');
  await tx.insert(rentLedger).values({
    organizationId: args.organizationId,
    tenancyId: args.tenancyId,
    kind: 'payment',
    amountCents: args.amountCents,
    effectiveDate: args.date,
    reference: args.reference,
  });
  await writeAudit(tx, {
    organizationId: args.organizationId,
    actorType: args.actor.type,
    actorId: args.actor.id,
    action: 'rent.payment_recorded',
    reason: args.reference ?? 'Payment recorded',
    input: { tenancyId: args.tenancyId, amountCents: args.amountCents, date: args.date },
    outcome: 'ok',
  });
}

/** Current tenancies whose rent is managed here, with their primary contact. */
export async function tenanciesWithRent(db: DbOrTx, organizationId: string) {
  return db
    .select({ tenancyId: tenancies.id, tenantId: tenancyTenants.tenantId })
    .from(tenancies)
    .innerJoin(
      tenancyTenants,
      and(
        eq(tenancyTenants.organizationId, tenancies.organizationId),
        eq(tenancyTenants.tenancyId, tenancies.id),
        eq(tenancyTenants.isPrimaryContact, true),
      ),
    )
    .where(and(eq(tenancies.organizationId, organizationId), isNotNull(tenancies.rentCents)));
}

export async function getCase(
  db: DbOrTx,
  organizationId: string,
  caseId: string,
): Promise<ArrearsCase> {
  const [row] = await db
    .select()
    .from(arrearsCases)
    .where(and(eq(arrearsCases.organizationId, organizationId), eq(arrearsCases.id, caseId)));
  if (!row) throw new DomainError('NOT_FOUND', 'Arrears case not found', { caseId });
  return row;
}

const openStates = notInArray(arrearsCases.state, ARREARS_TERMINAL as ArrearsState[]);

export async function findOpenCase(
  db: DbOrTx,
  organizationId: string,
  by: { tenancyId: string } | { tenantId: string },
): Promise<ArrearsCase | null> {
  const [row] = await db
    .select()
    .from(arrearsCases)
    .where(
      and(
        eq(arrearsCases.organizationId, organizationId),
        'tenancyId' in by
          ? eq(arrearsCases.tenancyId, by.tenancyId)
          : eq(arrearsCases.tenantId, by.tenantId),
        openStates,
      ),
    )
    .orderBy(desc(arrearsCases.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listOpenCaseIds(db: DbOrTx, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: arrearsCases.id })
    .from(arrearsCases)
    .where(and(eq(arrearsCases.organizationId, organizationId), openStates));
  return rows.map((r) => r.id);
}

export async function openCase(
  tx: DbOrTx,
  args: {
    organizationId: string;
    tenancyId: string;
    tenantId: string;
    position: LedgerPosition;
  },
): Promise<ArrearsCase | null> {
  if (!args.position.oldestUnpaidDate) return null;
  const [row] = await tx
    .insert(arrearsCases)
    .values({
      organizationId: args.organizationId,
      tenancyId: args.tenancyId,
      tenantId: args.tenantId,
      balanceCents: args.position.balanceCents,
      oldestUnpaidDate: args.position.oldestUnpaidDate,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null; // a concurrent sweep opened it
  await writeAudit(tx, {
    organizationId: args.organizationId,
    arrearsCaseId: row.id,
    actorType: 'agent',
    action: 'arrears.opened',
    reason: `Rent ${String(args.position.daysOverdue)} days overdue`,
    output: { ...args.position },
    outcome: 'ok',
  });
  return row;
}

/** The only way a case changes state: state machine check, optimistic lock, audit (rules 1, 4). */
export async function transitionCase(
  tx: DbOrTx,
  args: {
    organizationId: string;
    caseId: string;
    to: ArrearsState;
    actor: { type: ActorType; id?: string | null };
    reason: string;
    patch?: CasePatch;
    now: Date;
  },
): Promise<ArrearsCase> {
  const current = await getCase(tx, args.organizationId, args.caseId);
  const check = checkArrearsTransition(current.state, args.to, {
    actor: args.actor.type,
    stateBeforeEscalation: current.stateBeforeEscalation,
  });
  if (!check.ok) {
    throw new DomainError('INVALID_TRANSITION', check.reason, {
      from: current.state,
      to: args.to,
    });
  }
  const terminal = ARREARS_TERMINAL.includes(args.to);
  const [row] = await tx
    .update(arrearsCases)
    .set({
      ...args.patch,
      state: args.to,
      stateBeforeEscalation:
        args.to === 'ESCALATED'
          ? current.state
          : current.state === 'ESCALATED'
            ? null
            : current.stateBeforeEscalation,
      version: current.version + 1,
      closedAt: terminal ? args.now : null,
    })
    .where(
      and(
        eq(arrearsCases.organizationId, args.organizationId),
        eq(arrearsCases.id, args.caseId),
        eq(arrearsCases.version, current.version),
      ),
    )
    .returning();
  if (!row) throw new DomainError('CONFLICT', 'Arrears case changed concurrently; retry');
  await writeAudit(tx, {
    organizationId: args.organizationId,
    arrearsCaseId: args.caseId,
    actorType: args.actor.type,
    actorId: args.actor.id ?? null,
    action: 'arrears.transition',
    reason: args.reason,
    input: { from: current.state, to: args.to, patch: args.patch ?? null },
    outcome: 'ok',
  });
  return row;
}

export async function patchCase(
  tx: DbOrTx,
  args: { organizationId: string; caseId: string; patch: CasePatch; reason: string },
): Promise<ArrearsCase> {
  const current = await getCase(tx, args.organizationId, args.caseId);
  const [row] = await tx
    .update(arrearsCases)
    .set({ ...args.patch, version: current.version + 1 })
    .where(
      and(
        eq(arrearsCases.organizationId, args.organizationId),
        eq(arrearsCases.id, args.caseId),
        eq(arrearsCases.version, current.version),
      ),
    )
    .returning();
  if (!row) throw new DomainError('CONFLICT', 'Arrears case changed concurrently; retry');
  await writeAudit(tx, {
    organizationId: args.organizationId,
    arrearsCaseId: args.caseId,
    actorType: 'agent',
    action: 'arrears.patch',
    reason: args.reason,
    input: args.patch,
    outcome: 'ok',
  });
  return row;
}

/** Facts the agent and the dashboard need about a case. */
export async function loadCaseContext(db: DbOrTx, c: ArrearsCase) {
  const [row] = await db
    .select({
      tenantName: tenants.fullName,
      preferredLanguage: tenants.preferredLanguage,
      address: properties.addressLine1,
      suburb: properties.suburb,
      propertyManagerId: properties.propertyManagerId,
      rentCents: tenancies.rentCents,
      rentFrequency: tenancies.rentFrequency,
    })
    .from(tenancies)
    .innerJoin(
      properties,
      and(
        eq(properties.organizationId, tenancies.organizationId),
        eq(properties.id, tenancies.propertyId),
      ),
    )
    .innerJoin(
      tenants,
      and(eq(tenants.organizationId, c.organizationId), eq(tenants.id, c.tenantId)),
    )
    .where(and(eq(tenancies.organizationId, c.organizationId), eq(tenancies.id, c.tenancyId)));
  if (!row) throw new Error(`Tenancy missing for arrears case ${c.id}`);
  return row;
}
export type CaseContext = Awaited<ReturnType<typeof loadCaseContext>>;

export async function listArrearsCases(db: DbOrTx, organizationId: string) {
  return db
    .select({
      id: arrearsCases.id,
      state: arrearsCases.state,
      balanceCents: arrearsCases.balanceCents,
      oldestUnpaidDate: arrearsCases.oldestUnpaidDate,
      promiseAmountCents: arrearsCases.promiseAmountCents,
      promiseDate: arrearsCases.promiseDate,
      planInstalmentCents: arrearsCases.planInstalmentCents,
      planFrequency: arrearsCases.planFrequency,
      escalationReason: arrearsCases.escalationReason,
      tenancyId: arrearsCases.tenancyId,
      tenantName: tenants.fullName,
      address: properties.addressLine1,
      suburb: properties.suburb,
      updatedAt: arrearsCases.updatedAt,
    })
    .from(arrearsCases)
    .innerJoin(
      tenants,
      and(
        eq(tenants.organizationId, arrearsCases.organizationId),
        eq(tenants.id, arrearsCases.tenantId),
      ),
    )
    .innerJoin(
      tenancies,
      and(
        eq(tenancies.organizationId, arrearsCases.organizationId),
        eq(tenancies.id, arrearsCases.tenancyId),
      ),
    )
    .innerJoin(
      properties,
      and(
        eq(properties.organizationId, tenancies.organizationId),
        eq(properties.id, tenancies.propertyId),
      ),
    )
    .where(eq(arrearsCases.organizationId, organizationId))
    .orderBy(desc(arrearsCases.updatedAt));
}

/** 14-day notices waiting for a PM (Approvals page). */
export async function listPendingNotices(db: DbOrTx, organizationId: string) {
  return db
    .select({
      id: approvals.id,
      caseId: arrearsCases.id,
      amountCents: approvals.amountCents,
      reason: approvals.reason,
      createdAt: approvals.createdAt,
      tenantName: tenants.fullName,
      address: properties.addressLine1,
      suburb: properties.suburb,
    })
    .from(approvals)
    .innerJoin(
      arrearsCases,
      and(
        eq(arrearsCases.organizationId, approvals.organizationId),
        eq(arrearsCases.id, approvals.arrearsCaseId),
      ),
    )
    .innerJoin(
      tenants,
      and(
        eq(tenants.organizationId, arrearsCases.organizationId),
        eq(tenants.id, arrearsCases.tenantId),
      ),
    )
    .innerJoin(
      tenancies,
      and(
        eq(tenancies.organizationId, arrearsCases.organizationId),
        eq(tenancies.id, arrearsCases.tenancyId),
      ),
    )
    .innerJoin(
      properties,
      and(
        eq(properties.organizationId, tenancies.organizationId),
        eq(properties.id, tenancies.propertyId),
      ),
    )
    .where(and(eq(approvals.organizationId, organizationId), eq(approvals.status, 'pending')))
    .orderBy(desc(approvals.createdAt));
}
