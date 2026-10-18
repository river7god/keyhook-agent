import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, organizationId, tstz } from './columns';
import { monitorFindingKindEnum, monitorFindingStatusEnum, tradeEnum } from './enums';
import { organizations } from './organizations';
import { properties } from './properties';

/**
 * Portfolio Monitor findings (spec §12 R7). The monitor only proposes: a PM opens a finding as a
 * job (`agent_detected`) or dismisses it. One open finding per property + kind + trade.
 */
export const monitorFindings = pgTable(
  'monitor_findings',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    propertyId: uuid().notNull(),
    kind: monitorFindingKindEnum().notNull(),
    trade: tradeEnum().notNull(),
    /** The jobs that triggered it, oldest first. */
    evidenceJobIds: uuid().array().notNull(),
    summary: text().notNull(),
    recommendation: text().notNull(),
    status: monitorFindingStatusEnum().notNull().default('open'),
    openedJobId: uuid(),
    decidedBy: text(),
    decisionNote: text(),
    decidedAt: tstz(),
    detectedAt: tstz().notNull(),
    updatedAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index('monitor_findings_org_status_idx').on(t.organizationId, t.status),
    uniqueIndex('monitor_findings_one_open_uq')
      .on(t.organizationId, t.propertyId, t.kind, t.trade)
      .where(sql`${t.status} = 'open'`),
    foreignKey({
      name: 'monitor_findings_property_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }),
  ],
);
