import type { organizations, owners, propertyManagers } from '@/db/schema';
import { ORG, OWNER, PM } from '../ids';

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

// All names, emails and phone numbers are fictional.
export const organizationRows: Insert<typeof organizations>[] = [
  {
    id: ORG.harbourCity,
    name: 'Harbour City Property Management',
    slug: 'harbour-city',
    defaultPmAutoApproveLimitCents: 30_000, // $300
  },
  {
    // Second, tiny organization — exists to prove tenant isolation.
    id: ORG.aroValley,
    name: 'Aro Valley Lettings',
    slug: 'aro-valley',
    defaultPmAutoApproveLimitCents: 20_000,
  },
];

export const propertyManagerRows: Insert<typeof propertyManagers>[] = [
  {
    id: PM.aroha,
    organizationId: ORG.harbourCity,
    fullName: 'Aroha Ngata',
    email: 'aroha@harbourcity.example.test',
    phone: '+64 21 000 0101',
    autoApproveLimitCents: 50_000, // senior PM: personal $500 limit
  },
  {
    id: PM.liam,
    organizationId: ORG.harbourCity,
    fullName: 'Liam Chen',
    email: 'liam@harbourcity.example.test',
    phone: '+64 21 000 0102',
    autoApproveLimitCents: null, // uses org default ($300)
  },
  {
    id: PM.mere,
    organizationId: ORG.aroValley,
    fullName: 'Mere Tawhiri',
    email: 'mere@arovalley.example.test',
    autoApproveLimitCents: null,
  },
];

export const ownerRows: Insert<typeof owners>[] = [
  {
    id: OWNER.wilson,
    organizationId: ORG.harbourCity,
    fullName: 'Margaret Wilson',
    email: 'margaret.wilson@example.test',
    approvalLimitCents: 100_000,
  },
  {
    id: OWNER.tePuniTrust,
    organizationId: ORG.harbourCity,
    fullName: 'Te Puni Whānau Trust',
    email: 'trustees@tepuni.example.test',
    approvalLimitCents: 250_000,
  },
  {
    id: OWNER.patel,
    organizationId: ORG.harbourCity,
    fullName: 'Priya Patel',
    email: 'priya.patel@example.test',
    approvalLimitCents: 50_000,
  },
  {
    id: OWNER.kim,
    organizationId: ORG.harbourCity,
    fullName: 'Daniel Kim',
    email: 'daniel.kim@example.test',
    approvalLimitCents: 150_000,
  },
  {
    id: OWNER.walkerTrust,
    organizationId: ORG.harbourCity,
    fullName: 'Walker Family Trust',
    email: 'walker.trust@example.test',
    approvalLimitCents: 200_000,
  },
  // Edge case: owner limit ($200) below the PM's limit → PM auto-approval is capped at $200.
  {
    id: OWNER.oconnell,
    organizationId: ORG.harbourCity,
    fullName: "Sarah O'Connell",
    email: 'sarah.oconnell@example.test',
    approvalLimitCents: 20_000,
  },
  {
    id: OWNER.aroValleyOwner,
    organizationId: ORG.aroValley,
    fullName: 'Tom Riley',
    approvalLimitCents: 80_000,
  },
];
