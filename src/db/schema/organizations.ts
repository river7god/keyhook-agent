import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';
import {
  DEFAULT_TRADIE_SELECTION,
  type TradieSelectionConfig,
} from '@/domain/tradie-selection-config';
import { DEFAULT_WORKFLOW_POLICY, type WorkflowPolicy } from '@/domain/workflow-policy-config';
import { id, organizationId, timestamps } from './columns';

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    timezone: text().notNull().default('Pacific/Auckland'),
    /** Fallback PM auto-approval limit when a PM has no personal limit. */
    defaultPmAutoApproveLimitCents: integer().notNull(),
    /** Validated with tradieSelectionConfigSchema on read. */
    tradieSelection: jsonb()
      .$type<TradieSelectionConfig>()
      .notNull()
      .default(DEFAULT_TRADIE_SELECTION),
    /** Follow-up timings and retry limits; validated with workflowPolicySchema on read. */
    workflowPolicy: jsonb().$type<WorkflowPolicy>().notNull().default(DEFAULT_WORKFLOW_POLICY),
    ...timestamps,
  },
  (t) => [
    check('organizations_default_limit_nonneg', sql`${t.defaultPmAutoApproveLimitCents} >= 0`),
  ],
);

export const propertyManagers = pgTable(
  'property_managers',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    fullName: text().notNull(),
    email: text().notNull(),
    phone: text(),
    /** Null → use organizations.default_pm_auto_approve_limit_cents. */
    autoApproveLimitCents: integer(),
    active: boolean().notNull().default(true),
    /** scrypt hash (src/lib/password.ts). Null = cannot log in. */
    passwordHash: text(),
    ...timestamps,
  },
  (t) => [
    unique('property_managers_org_id_uq').on(t.organizationId, t.id),
    unique('property_managers_org_email_uq').on(t.organizationId, t.email),
    check('property_managers_limit_nonneg', sql`${t.autoApproveLimitCents} >= 0`),
  ],
);
