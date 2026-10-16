import { foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, organizationId, timestamps } from './columns';
import { organizations, propertyManagers } from './organizations';
import { owners } from './owners';

export const properties = pgTable(
  'properties',
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    ownerId: uuid().notNull(),
    propertyManagerId: uuid().notNull(),
    addressLine1: text().notNull(),
    suburb: text().notNull(),
    city: text().notNull().default('Wellington'),
    postcode: text().notNull(),
    /** Keys, pets, gate codes. Entered by PM — trusted. */
    accessNotes: text(),
    ...timestamps,
  },
  (t) => [
    unique('properties_org_id_uq').on(t.organizationId, t.id),
    index('properties_org_suburb_idx').on(t.organizationId, t.suburb),
    foreignKey({
      name: 'properties_owner_fk',
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [owners.organizationId, owners.id],
    }),
    foreignKey({
      name: 'properties_pm_fk',
      columns: [t.organizationId, t.propertyManagerId],
      foreignColumns: [propertyManagers.organizationId, propertyManagers.id],
    }),
  ],
);
