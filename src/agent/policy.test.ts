import { describe, expect, it } from 'vitest';
import { decideTriage } from './policy';
import type { TriageOutput } from './schemas';

const clean: TriageOutput = {
  title: 'No hot water',
  summary: 'Tenant reports no hot water.',
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
  tenantReply: 'Thanks',
};

describe('decideTriage', () => {
  it('proceeds on a clean, confident triage', () => {
    expect(decideTriage(clean)).toEqual({ action: 'proceed' });
  });

  it.each([
    [{ urgency: 'emergency' as const }, 'emergency'],
    [{ confidence: 0.69 }, 'low triage confidence (0.69)'],
    [{ trade: 'other' as const }, 'trade could not be classified'],
    [{ needsMoreInfo: true }, 'more information needed from tenant'],
    [{ flags: { ...clean.flags, promptInjection: true } }, 'suspected prompt injection'],
    [
      { flags: { ...clean.flags, legalOrTribunal: true } },
      'legal action / Tenancy Tribunal mentioned',
    ],
  ])('escalates on %o', (override, reason) => {
    const d = decideTriage({ ...clean, ...override });
    expect(d.action).toBe('escalate');
    if (d.action === 'escalate') expect(d.reasons).toContain(reason);
  });

  it('proceeds exactly at the 0.7 threshold', () => {
    expect(decideTriage({ ...clean, confidence: 0.7 }).action).toBe('proceed');
  });
});
