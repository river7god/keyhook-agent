import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { organizations, owners, properties, propertyManagers } from '@/db/schema';
import { assertCents, type Cents } from '@/lib/money';
import { DomainError } from './errors';

/**
 * Spend approval policy (spec §5, §7; decisions.md 2026-10-17).
 *
 *   estimate ≤ effective PM limit   → auto_approve
 *   estimate ≤ owner limit          → pm_approval
 *   estimate >  owner limit         → escalate (owner authority needed)
 *
 * effective PM limit = min(pm.limit ?? org.default, owner.limit) — a PM's auto-approval can never
 * exceed what the owner has authorised.
 */
export interface ApprovalLimits {
  pmLimitCents: Cents | null;
  orgDefaultPmLimitCents: Cents;
  ownerLimitCents: Cents;
}

export type ApprovalDecision =
  | { kind: 'auto_approve'; effectivePmLimitCents: Cents }
  | { kind: 'pm_approval'; effectivePmLimitCents: Cents; ownerLimitCents: Cents }
  | { kind: 'escalate'; ownerLimitCents: Cents };

export function effectivePmLimitCents(limits: ApprovalLimits): Cents {
  const pm = limits.pmLimitCents ?? limits.orgDefaultPmLimitCents;
  return Math.min(pm, limits.ownerLimitCents);
}

export function decideApproval(estimateCents: Cents, limits: ApprovalLimits): ApprovalDecision {
  assertCents(estimateCents);
  const effective = effectivePmLimitCents(limits);
  if (estimateCents <= effective) {
    return { kind: 'auto_approve', effectivePmLimitCents: effective };
  }
  if (estimateCents <= limits.ownerLimitCents) {
    return {
      kind: 'pm_approval',
      effectivePmLimitCents: effective,
      ownerLimitCents: limits.ownerLimitCents,
    };
  }
  return { kind: 'escalate', ownerLimitCents: limits.ownerLimitCents };
}

/** Load the limits that apply to a property. Always scoped by organization. */
export async function loadApprovalLimits(
  db: DbOrTx,
  organizationId: string,
  propertyId: string,
): Promise<ApprovalLimits> {
  const [row] = await db
    .select({
      pmLimitCents: propertyManagers.autoApproveLimitCents,
      orgDefaultPmLimitCents: organizations.defaultPmAutoApproveLimitCents,
      ownerLimitCents: owners.approvalLimitCents,
    })
    .from(properties)
    .innerJoin(organizations, eq(organizations.id, properties.organizationId))
    .innerJoin(
      owners,
      and(eq(owners.organizationId, properties.organizationId), eq(owners.id, properties.ownerId)),
    )
    .innerJoin(
      propertyManagers,
      and(
        eq(propertyManagers.organizationId, properties.organizationId),
        eq(propertyManagers.id, properties.propertyManagerId),
      ),
    )
    .where(and(eq(properties.organizationId, organizationId), eq(properties.id, propertyId)));

  if (!row) throw new DomainError('NOT_FOUND', 'Property not found', { propertyId });
  return row;
}
