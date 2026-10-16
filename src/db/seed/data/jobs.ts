import type { jobs } from '@/db/schema';
import { ORG, PROPERTY, TRADIE, seedId } from '../ids';
import { currentTenancyFor, primaryTenantFor } from './tenancies';

type Row = (typeof jobs)['$inferInsert'];

const hc = ORG.harbourCity;
const newtownTenancy = currentTenancyFor(PROPERTY.newtown);
const newtownTenant = primaryTenantFor(newtownTenancy.id);

function closedTenantJob(
  n: number,
  fields: Pick<
    Row,
    'title' | 'description' | 'urgency' | 'trade' | 'estimateCents' | 'assignedTradieId'
  > & {
    createdAt: string;
    closedAt: string;
  },
): Row {
  return {
    id: seedId('job', n),
    organizationId: hc,
    propertyId: PROPERTY.newtown,
    tenancyId: newtownTenancy.id,
    reportedByTenantId: newtownTenant,
    source: 'tenant_message',
    createdByActorType: 'tenant',
    createdByActorId: newtownTenant,
    state: 'CLOSED',
    triageConfidence: 0.9,
    ...fields,
    createdAt: new Date(fields.createdAt),
    updatedAt: new Date(fields.closedAt),
    closedAt: new Date(fields.closedAt),
  };
}

/**
 * Historical jobs only — live jobs are created through the simulator/agent.
 * Newtown has three hot-water faults this year: fixture for "repeated issue" detection.
 */
export const jobRows: Row[] = [
  closedTenantJob(1, {
    title: 'No hot water',
    description: 'Gas hot water cylinder not igniting.',
    urgency: 'urgent',
    trade: 'plumbing',
    estimateCents: 18_500,
    assignedTradieId: TRADIE.capitalPlumbing,
    createdAt: '2026-02-03T19:12:00Z',
    closedAt: '2026-02-05T03:30:00Z',
  }),
  closedTenantJob(2, {
    title: 'Hot water lukewarm',
    description: 'Water only lukewarm; pilot light keeps going out.',
    urgency: 'urgent',
    trade: 'plumbing',
    estimateCents: 22_000,
    assignedTradieId: TRADIE.capitalPlumbing,
    createdAt: '2026-05-20T21:40:00Z',
    closedAt: '2026-05-22T01:15:00Z',
  }),
  closedTenantJob(3, {
    title: 'No hot water again',
    description: 'Cylinder thermocouple replaced; tradie recommends cylinder replacement.',
    urgency: 'urgent',
    trade: 'plumbing',
    estimateCents: 26_000,
    assignedTradieId: TRADIE.southCoastPlumbing,
    createdAt: '2026-08-11T18:05:00Z',
    closedAt: '2026-08-12T23:50:00Z',
  }),
  {
    id: seedId('job', 4),
    organizationId: hc,
    propertyId: PROPERTY.thorndon,
    source: 'inspection',
    createdByActorType: 'pm',
    createdByActorId: 'liam@harbourcity.example.test',
    title: 'Missing extractor fan in bathroom',
    description:
      'Routine inspection: Healthy Homes ventilation gap. Owner chose to defer — cancelled.',
    state: 'CANCELLED',
    urgency: 'routine',
    trade: 'electrical',
    createdAt: new Date('2026-06-10T22:00:00Z'),
    updatedAt: new Date('2026-06-12T02:00:00Z'),
  },
];
