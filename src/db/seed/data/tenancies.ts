import { ORG, PROPERTY, seedId } from '../ids';

interface SeedTenant {
  fullName: string;
  phone?: string;
  email?: string;
  preferredLanguage?: string;
  primary?: boolean;
}

interface SeedTenancy {
  organizationId: string;
  propertyId: string;
  startDate: string;
  endDate?: string;
  tenants: SeedTenant[];
}

const hc = ORG.harbourCity;

/**
 * 10 current Harbour City tenancies (one per property) + 5 ended ones for history,
 * plus one Aro Valley tenancy. Tenant names are fictional.
 */
const tenancySpecs: SeedTenancy[] = [
  // Current
  {
    organizationId: hc,
    propertyId: PROPERTY.teAro,
    startDate: '2025-03-01',
    tenants: [
      {
        fullName: 'Jordan Smith',
        phone: '+64 21 000 1001',
        email: 'jordan.smith@example.test',
        primary: true,
      },
    ],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.newtown,
    startDate: '2024-11-15',
    tenants: [
      { fullName: 'Ana Tuilagi', phone: '+64 21 000 1002', preferredLanguage: 'sm', primary: true },
      { fullName: 'Sione Tuilagi', phone: '+64 21 000 1003' },
      { fullName: 'Grace Tuilagi', phone: '+64 21 000 1004' },
    ],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.kelburn,
    startDate: '2026-02-01',
    tenants: [
      {
        fullName: 'Ethan Brown',
        phone: '+64 21 000 1005',
        email: 'ethan.b@example.test',
        primary: true,
      },
      { fullName: 'Mia Johansson', phone: '+64 21 000 1006' },
      { fullName: 'Arjun Mehta', phone: '+64 21 000 1007' },
    ],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.karori,
    startDate: '2023-07-01',
    tenants: [
      {
        fullName: 'Helen Murray',
        phone: '+64 21 000 1008',
        email: 'helen.murray@example.test',
        primary: true,
      },
    ],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.islandBay,
    startDate: '2025-09-01',
    tenants: [
      { fullName: 'Wei Zhang', phone: '+64 21 000 1009', preferredLanguage: 'zh', primary: true },
      { fullName: 'Lin Zhang', phone: '+64 21 000 1010', preferredLanguage: 'zh' },
    ],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.miramar,
    startDate: '2026-04-15',
    tenants: [{ fullName: 'Tama Rangi', phone: '+64 21 000 1011', primary: true }],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.brooklyn,
    startDate: '2025-01-10',
    tenants: [
      { fullName: 'Olivia Harris', phone: '+64 21 000 1012', primary: true },
      { fullName: 'Ben Harris', phone: '+64 21 000 1013' },
    ],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.thorndon,
    startDate: '2024-06-01',
    tenants: [
      {
        fullName: 'Charlotte Evans',
        phone: '+64 21 000 1014',
        email: 'c.evans@example.test',
        primary: true,
      },
    ],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.mtVictoria,
    startDate: '2026-01-20',
    tenants: [
      { fullName: 'Noah Williams', phone: '+64 21 000 1015', primary: true },
      { fullName: 'Isla Thompson', phone: '+64 21 000 1016' },
    ],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.johnsonville,
    startDate: '2025-05-01',
    tenants: [{ fullName: 'Rahul Sharma', phone: '+64 21 000 1017', primary: true }],
  },
  // Ended (history)
  {
    organizationId: hc,
    propertyId: PROPERTY.teAro,
    startDate: '2023-02-01',
    endDate: '2025-02-14',
    tenants: [{ fullName: 'Kate Fraser', phone: '+64 21 000 1018', primary: true }],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.kelburn,
    startDate: '2024-02-01',
    endDate: '2026-01-25',
    tenants: [{ fullName: 'Liam Doyle', phone: '+64 21 000 1019', primary: true }],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.miramar,
    startDate: '2022-04-01',
    endDate: '2026-04-01',
    tenants: [{ fullName: 'Sophie Clarke', phone: '+64 21 000 1020', primary: true }],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.mtVictoria,
    startDate: '2024-01-15',
    endDate: '2025-12-20',
    tenants: [{ fullName: 'Hannah Lee', phone: '+64 21 000 1021', primary: true }],
  },
  {
    organizationId: hc,
    propertyId: PROPERTY.johnsonville,
    startDate: '2023-05-01',
    endDate: '2025-04-20',
    tenants: [{ fullName: 'Matthew Ross', phone: '+64 21 000 1022', primary: true }],
  },
  // Aro Valley Lettings
  {
    organizationId: ORG.aroValley,
    propertyId: PROPERTY.aroValley,
    startDate: '2025-08-01',
    tenants: [{ fullName: 'Zoe Martin', phone: '+64 21 000 2001', primary: true }],
  },
];

/** Rent for current tenancies (cents NZD per period). */
export const RENT: Record<string, { cents: number; frequency: 'weekly' | 'fortnightly' }> = {
  [PROPERTY.teAro]: { cents: 52_000, frequency: 'weekly' },
  [PROPERTY.newtown]: { cents: 61_000, frequency: 'weekly' },
  [PROPERTY.kelburn]: { cents: 55_000, frequency: 'weekly' },
  [PROPERTY.karori]: { cents: 68_000, frequency: 'weekly' },
  [PROPERTY.islandBay]: { cents: 58_000, frequency: 'weekly' },
  [PROPERTY.miramar]: { cents: 116_000, frequency: 'fortnightly' },
  [PROPERTY.brooklyn]: { cents: 54_000, frequency: 'weekly' },
  [PROPERTY.thorndon]: { cents: 72_000, frequency: 'weekly' },
  [PROPERTY.mtVictoria]: { cents: 64_000, frequency: 'weekly' },
  [PROPERTY.johnsonville]: { cents: 50_000, frequency: 'weekly' },
  [PROPERTY.aroValley]: { cents: 47_000, frequency: 'weekly' },
};

/** Stable ids assigned by position; exported so jobs/tests can find e.g. the Newtown tenancy. */
export const tenancyRows = tenancySpecs.map((t, i) => {
  const rent = t.endDate ? undefined : RENT[t.propertyId];
  return {
    id: seedId('tenancy', i + 1),
    organizationId: t.organizationId,
    propertyId: t.propertyId,
    startDate: t.startDate,
    endDate: t.endDate ?? null,
    rentCents: rent?.cents ?? null,
    rentFrequency: rent?.frequency ?? null,
  };
});

export const tenantRows = tenancySpecs
  .flatMap((t) =>
    t.tenants.map((p) => ({
      organizationId: t.organizationId,
      fullName: p.fullName,
      phone: p.phone ?? null,
      email: p.email ?? null,
      preferredLanguage: p.preferredLanguage ?? 'en',
    })),
  )
  .map((row, i) => ({ id: seedId('tenant', i + 1), ...row }));

export const tenancyTenantRows = (() => {
  let tenantIndex = 0;
  return tenancySpecs.flatMap((t, i) =>
    t.tenants.map((p) => {
      const tenant = tenantRows[tenantIndex++];
      if (!tenant) throw new Error('tenant index out of range');
      return {
        organizationId: t.organizationId,
        tenancyId: seedId('tenancy', i + 1),
        tenantId: tenant.id,
        isPrimaryContact: p.primary ?? false,
      };
    }),
  );
})();

export function currentTenancyFor(propertyId: string) {
  const row = tenancyRows.find((t) => t.propertyId === propertyId && t.endDate === null);
  if (!row) throw new Error(`No current tenancy for property ${propertyId}`);
  return row;
}

export function primaryTenantFor(tenancyId: string) {
  const link = tenancyTenantRows.find((l) => l.tenancyId === tenancyId && l.isPrimaryContact);
  if (!link) throw new Error(`No primary tenant for tenancy ${tenancyId}`);
  return link.tenantId;
}
