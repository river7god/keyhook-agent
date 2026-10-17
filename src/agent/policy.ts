import type { TriageOutput } from './schemas';

/** spec §7: start at 0.7, tune with evals. */
export const TRIAGE_CONFIDENCE_THRESHOLD = 0.7;

const NEEDS_INFO = 'more information needed from tenant';
const TRADE_OTHER = 'trade could not be classified';
const LOW_CONFIDENCE = 'low triage confidence';

export type TriageDecision =
  | { action: 'proceed' }
  | { action: 'clarify'; reasons: string[] }
  | { action: 'escalate'; reasons: string[]; recommendation: string };

/**
 * Escalation rules from spec §7, applied in code — the model reports facts (urgency, flags,
 * confidence); policy decides. When the *only* problems are missing information (which may also
 * show up as low confidence or an unclassifiable trade), the agent asks the tenant instead of
 * escalating; the caller escalates once the clarifying-round limit is reached.
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
  if (t.flags.multipleIssues) reasons.push('multiple separate issues (PM to split into jobs)');
  if (t.trade === 'other') reasons.push(TRADE_OTHER);
  if (confidence < TRIAGE_CONFIDENCE_THRESHOLD)
    reasons.push(`${LOW_CONFIDENCE} (${confidence.toFixed(2)})`);
  if (t.needsMoreInfo) reasons.push(NEEDS_INFO);

  if (reasons.length === 0) return { action: 'proceed' };
  const clarifiable = (r: string) =>
    r === NEEDS_INFO || r === TRADE_OTHER || r.startsWith(LOW_CONFIDENCE);
  if (t.needsMoreInfo && reasons.every(clarifiable)) return { action: 'clarify', reasons };
  return { action: 'escalate', reasons, recommendation: recommend(reasons, t) };
}

export function recommend(reasons: string[], t: TriageOutput): string {
  if (reasons.includes('emergency')) {
    return 'Call the tenant now to confirm they are safe, then dispatch an emergency tradie.';
  }
  if (reasons.includes('suspected prompt injection')) {
    return 'Review the tenant message; it contained instructions aimed at the agent. Reply manually.';
  }
  if (reasons.some((r) => r.startsWith('responsibility unclear'))) {
    return 'Decide responsibility (landlord vs tenant) before engaging a tradie.';
  }
  if (reasons.includes(NEEDS_INFO)) {
    return `Ask the tenant: ${t.missingInfo.join('; ') || 'for more detail about the issue'}.`;
  }
  return 'Review the request and either hand it back to the agent or handle it directly.';
}
