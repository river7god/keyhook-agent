import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  real,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps, tstz } from './columns';
import { actorTypeEnum, jobSourceEnum, jobStateEnum, tradeEnum, urgencyEnum } from './enums';
import { organizations } from './organizations';
import { properties } from './properties';
import { tenancies, tenants } from './tenancies';
import { tradies } from './tradies';

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    propertyId: uuid().notNull(),
    tenancyId: uuid(),
    /** Null for PM-created / agent-detected / inspection jobs. */
    reportedByTenantId: uuid(),
    source: jobSourceEnum().notNull(),
    createdByActorType: actorTypeEnum().notNull(),
    createdByActorId: text(),
    title: text().notNull(),
    description: text().notNull(),
    /** Agent-written English summary from triage (for PMs and tradie briefs; never raw tenant text). */
    summary: text(),

    state: jobStateEnum().notNull().default('RECEIVED'),
    /** Set only while ESCALATED, so a PM can hand the job back to where it was. */
    stateBeforeEscalation: jobStateEnum(),
    /** Optimistic lock: every state transition does `WHERE version = $expected`. */
    version: integer().notNull().default(0),

    urgency: urgencyEnum(),
    trade: tradeEnum(),
    triageConfidence: real(),
    estimateCents: integer(),
    assignedTradieId: uuid(),
    scheduledStart: tstz(),
    scheduledEnd: tstz(),
    /** Slots last offered to the tenant (SCHEDULING), in the order presented. */
    offeredSlotIds: uuid().array(),
    /** How many times visit slots have been offered (spec: re-offer up to policy max). */
    slotOfferCount: integer().notNull().default(0),
    /** Clarifying-question rounds so far. */
    clarifyRounds: integer().notNull().default(0),
    /** Tradies already tried for this job (declined / unresponsive) — never re-selected. */
    excludedTradieIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** What the agent asked the tenant to photograph (spec §12 R1); null if no media requested. */
    mediaRequest: text(),
    /** Set when a PM hands an escalated job back: their review covers the original triage flags. */
    pmReviewedAt: tstz(),
    closedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('jobs_org_id_uq').on(t.organizationId, t.id),
    index('jobs_org_state_idx').on(t.organizationId, t.state),
    index('jobs_org_property_created_idx').on(t.organizationId, t.propertyId, t.createdAt),
    check('jobs_confidence_range', sql`${t.triageConfidence} BETWEEN 0 AND 1`),
    check('jobs_estimate_nonneg', sql`${t.estimateCents} >= 0`),
    check(
      'jobs_schedule_window_valid',
      sql`(${t.scheduledStart} IS NULL) = (${t.scheduledEnd} IS NULL) AND (${t.scheduledEnd} IS NULL OR ${t.scheduledEnd} > ${t.scheduledStart})`,
    ),
    check(
      'jobs_escalation_consistent',
      sql`(${t.state} = 'ESCALATED') = (${t.stateBeforeEscalation} IS NOT NULL) AND ${t.stateBeforeEscalation} IS DISTINCT FROM 'ESCALATED'`,
    ),
    check(
      'jobs_tenant_source_has_reporter',
      sql`${t.source} <> 'tenant_message' OR ${t.reportedByTenantId} IS NOT NULL`,
    ),
    foreignKey({
      name: 'jobs_property_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }),
    foreignKey({
      name: 'jobs_tenancy_fk',
      columns: [t.organizationId, t.tenancyId],
      foreignColumns: [tenancies.organizationId, tenancies.id],
    }),
    foreignKey({
      name: 'jobs_reporter_fk',
      columns: [t.organizationId, t.reportedByTenantId],
      foreignColumns: [tenants.organizationId, tenants.id],
    }),
    foreignKey({
      name: 'jobs_tradie_fk',
      columns: [t.organizationId, t.assignedTradieId],
      foreignColumns: [tradies.organizationId, tradies.id],
    }),
  ],
);
