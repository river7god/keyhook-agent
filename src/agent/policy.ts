import type { TriageOutput } from './schemas';

/** spec §7: start at 0.7, tune with evals. */
export const TRIAGE_CONFIDENCE_THRESHOLD = 0.7;

export type TriageDecision =
  { action: 'proceed' } | { action: 'escalate'; reasons: string[]; recommendation: string };

/**
 * Escalation rules from spec §7, applied in code — the model reports facts (urgency, flags,
 * confidence); policy decides. `needsMoreInfo` escalates in M1; the clarifying loop is M2.
 */
export function decideTriage(t: TriageOutput): TriageDecision {
  const reasons: string[] = [];
  const confidence = Math.min(1, Math.max(0, t.confidence));
  if (t.urgency === 'emergency' || t.flags.emergencySignals) reasons.push('emergency');
  if (t.flags.injuryOrSafetyRisk) reasons.push('injury or safety risk');
  if (t.flags.legalOrTribunal) reasons.push('legal action / Tenancy Tribunal mentioned');
  if (t.flags.distressedOrAngry) reasons.push('tenant distressed or angry');
  if (t.flags.possibleTenantDamage) reasons.push('responsibility unclear (possible tenant damage)');
  if (t.flags.promptInjection) reasons.push('suspected prompt injection');
  if (t.flags.outOfScope) reasons.push('outside agent scope');
  if (t.trade === 'other') reasons.push('trade could not be classified');
  if (confidence < TRIAGE_CONFIDENCE_THRESHOLD)
    reasons.push(`low triage confidence (${confidence.toFixed(2)})`);
  if (t.needsMoreInfo) reasons.push('more information needed from tenant');

  if (reasons.length === 0) return { action: 'proceed' };
  return { action: 'escalate', reasons, recommendation: recommend(reasons, t) };
}

function recommend(reasons: string[], t: TriageOutput): string {
  if (reasons.includes('emergency')) {
    return 'Call the tenant now to confirm they are safe, then dispatch an emergency tradie.';
  }
  if (reasons.includes('suspected prompt injection')) {
    return 'Review the tenant message; it contained instructions aimed at the agent. Reply manually.';
  }
  if (reasons.some((r) => r.startsWith('responsibility unclear'))) {
    return 'Decide responsibility (landlord vs tenant) before engaging a tradie.';
  }
  if (reasons.includes('more information needed from tenant')) {
    return `Ask the tenant: ${t.missingInfo.join('; ') || 'for more detail about the issue'}.`;
  }
  return 'Review the request and either hand it back to the agent or handle it directly.';
}
