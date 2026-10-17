import { currentTenancyFor, primaryTenantFor } from '@/db/seed/data/tenancies';
import { ORG, PROPERTY } from '@/db/seed/ids';
import { ingestMessage } from '@/domain/inbound';
import type { AgentDeps } from '@/agent/advance';
import type { TriageOutput } from '@/agent/schemas';
import { testDb } from './db';
import { lastToolResult, ScriptedLlm, toolUse } from './fake-llm';

/** Shared fixtures for agent DB tests. */
export const db = testDb();
export const org = ORG.harbourCity;
export const now = new Date('2026-10-19T00:00:00Z'); // Monday 1pm NZDT
export const tenantId = primaryTenantFor(currentTenancyFor(PROPERTY.newtown).id);

export const cleanTriage: TriageOutput = {
  title: 'No hot water',
  summary: 'Tenant reports no hot water since this morning; gas cylinder suspected.',
  urgency: 'urgent',
  trade: 'plumbing',
  confidence: 0.9,
  needsMoreInfo: false,
  missingInfo: [],
  flags: {
    emergencySignals: false,
    injuryOrSafetyRisk: false,
    legalOrTribunal: false,
    distressedOrAngry: false,
    possibleTenantDamage: false,
    promptInjection: false,
    outOfScope: false,
    multipleIssues: false,
  },
  askForMedia: false,
  mediaToCapture: null,
  tenantReply: 'Thanks Ana — we have your request and are arranging a plumber.',
};

/** Happy-path script: picks the first selectable tradie, as a well-behaved model would. */
export function happyLlm(overrides: Partial<Record<string, (req: never) => unknown>> = {}) {
  return new ScriptedLlm(
    {
      triage: () => cleanTriage,
      'interpret.quote': () => ({
        kind: 'quote',
        amountNzd: '185',
        gst: 'included',
        notes: 'Thermocouple',
        promptInjection: false,
      }),
      'interpret.slot': () => ({
        chosenOption: 2,
        noneSuitable: false,
        accessNotes: 'Key under the mat',
        promptInjection: false,
      }),
      'interpret.progress': () => ({
        kind: 'completed',
        notes: 'Replaced thermocouple',
        promptInjection: false,
      }),
      'interpret.confirmation': () => ({ confirmed: 'yes', notes: '', promptInjection: false }),
      'compose.tenant': () => ({ body: 'Message to tenant' }),
      ...overrides,
    },
    {
      'act.triaged': (req, turn) => {
        if (turn === 0) return [toolUse('search_tradies', {})];
        const ids = lastToolResult(req).selectableTradieIds as string[];
        return [
          toolUse('request_quote', {
            tradieId: ids[0],
            scope: 'Diagnose and repair gas hot water cylinder not heating',
            messageToTradie: 'Hi, can you quote to fix a gas hot water cylinder in Newtown?',
            selectionReason: 'Top ranked; has worked at this property',
          }),
        ];
      },
    },
  );
}

export const deps = (llm: ScriptedLlm, clock: () => Date = () => now): AgentDeps => ({
  db,
  llm,
  now: clock,
});

export async function say(
  senderType: 'tenant' | 'tradie',
  senderId: string,
  body: string,
  jobId?: string,
) {
  return ingestMessage(db, {
    organizationId: org,
    senderType,
    senderId,
    jobId: jobId ?? null,
    body,
  });
}
