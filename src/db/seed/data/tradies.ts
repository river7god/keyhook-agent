import type { tradies } from '@/db/schema';
import { ORG, TRADIE } from '../ids';

type Row = (typeof tradies)['$inferInsert'];

const hc = ORG.harbourCity;
const CENTRAL = ['Te Aro', 'Thorndon', 'Kelburn', 'Mount Victoria', 'Aro Valley'];
const SOUTH = ['Newtown', 'Island Bay', 'Brooklyn', 'Miramar'];
const WEST_NORTH = ['Karori', 'Johnsonville'];

// Fictional businesses. Coverage gaps are deliberate eval fixtures (see comments).
export const tradieRows: Row[] = [
  {
    id: TRADIE.capitalPlumbing,
    organizationId: hc,
    businessName: 'Capital Plumbing & Gas',
    contactName: 'Mike Reid',
    phone: '+64 21 000 3001',
    email: 'jobs@capitalplumbing.example.test',
    trades: ['plumbing'],
    suburbs: [...CENTRAL, ...SOUTH, ...WEST_NORTH],
    rating: 4.7,
    emergencyCallouts: true,
  },
  {
    id: TRADIE.southCoastPlumbing,
    organizationId: hc,
    businessName: 'South Coast Plumbing',
    contactName: 'Tui Hemara',
    phone: '+64 21 000 3002',
    trades: ['plumbing'],
    suburbs: SOUTH,
    rating: 4.2,
  },
  {
    id: TRADIE.brightSparks,
    organizationId: hc,
    businessName: 'Bright Sparks Electrical',
    contactName: 'Priya Nair',
    phone: '+64 21 000 3003',
    email: 'office@brightsparks.example.test',
    trades: ['electrical'],
    suburbs: [...CENTRAL, ...SOUTH, ...WEST_NORTH],
    rating: 4.8,
    emergencyCallouts: true,
  },
  {
    id: TRADIE.windyCityElectrical,
    organizationId: hc,
    businessName: 'Windy City Electrical & Heat Pumps',
    contactName: 'Josh Bennett',
    phone: '+64 21 000 3004',
    trades: ['electrical', 'heating'],
    suburbs: [...CENTRAL, ...WEST_NORTH],
    rating: 4.5,
  },
  {
    id: TRADIE.heatPumpHeroes,
    organizationId: hc,
    businessName: 'Heat Pump Heroes',
    contactName: 'Anna Kowalski',
    phone: '+64 21 000 3005',
    trades: ['heating'],
    suburbs: [...CENTRAL, ...SOUTH],
    rating: 4.3,
  },
  {
    id: TRADIE.handyHana,
    organizationId: hc,
    businessName: 'Handy Hana',
    contactName: 'Hana Takahashi',
    phone: '+64 21 000 3006',
    trades: ['handyman'],
    suburbs: [...CENTRAL, ...SOUTH, ...WEST_NORTH],
    rating: 4.6,
  },
  // Inactive — must never be selected.
  {
    id: TRADIE.oldFixIt,
    organizationId: hc,
    businessName: 'Old Fix-It Services',
    contactName: 'Gary Holt',
    phone: '+64 21 000 3007',
    trades: ['handyman', 'plumbing'],
    suburbs: [...CENTRAL, ...SOUTH],
    rating: 3.9,
    active: false,
  },
  // Only locksmith — no fallback when unresponsive (spec §7 "no alternative tradie").
  {
    id: TRADIE.lockSafe,
    organizationId: hc,
    businessName: 'LockSafe Wellington',
    contactName: 'Dave Morgan',
    phone: '+64 21 000 3008',
    trades: ['locksmith'],
    suburbs: [...CENTRAL, ...SOUTH, ...WEST_NORTH],
    rating: 4.4,
    emergencyCallouts: true,
  },
  {
    id: TRADIE.aroValleyHandyman,
    organizationId: ORG.aroValley,
    businessName: 'Aro Odd Jobs',
    contactName: 'Finn Walsh',
    phone: '+64 21 000 4001',
    trades: ['handyman', 'plumbing'],
    suburbs: ['Aro Valley', 'Te Aro'],
    rating: 4.1,
  },
];
