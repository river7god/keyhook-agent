import { sql } from 'drizzle-orm';
import { boolean, check, index, numeric, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps } from './columns';
import { tradeEnum } from './enums';
import { organizations } from './organizations';

export const tradies = pgTable(
  'tradies',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    businessName: text().notNull(),
    contactName: text().notNull(),
    phone: text().notNull(),
    email: text(),
    trades: tradeEnum().array().notNull(),
    suburbs: text().array().notNull(),
    /** 0.0–5.0 */
    rating: numeric({ precision: 2, scale: 1, mode: 'number' }),
    emergencyCallouts: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('tradies_org_id_uq').on(t.organizationId, t.id),
    index('tradies_trades_gin').using('gin', t.trades),
    index('tradies_suburbs_gin').using('gin', t.suburbs),
    check('tradies_rating_range', sql`${t.rating} BETWEEN 0 AND 5`),
    check('tradies_has_trade', sql`cardinality(${t.trades}) > 0`),
    check('tradies_has_suburb', sql`cardinality(${t.suburbs}) > 0`),
  ],
);
