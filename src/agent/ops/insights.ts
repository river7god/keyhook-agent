import { cacheShare, type StepUsage, type UsageReport } from '@/domain/usage';
import { matchConfirmation, matchSlotChoice } from '../fast-intents';
import { costUsdMicros } from '../pricing';
import { stepTimeoutMs } from '../timeouts';

/**
 * Optimisation findings computed by code from a usage report. The Ops analyst agent ranks and
 * explains these. It cannot add findings of its own, so every recommendation traces back to a
 * number here. Nothing is changed automatically: routing and rules are changed by a person,
 * after an eval.
 */
export interface Insight {
  id: string;
  kind: 'risk' | 'saving' | 'info';
  title: string;
  evidence: string;
  action: string;
  /** Estimated saving per 30 days at the current volume, when it can be priced. */
  savingUsdPer30Days: number | null;
  needsEval: boolean;
}

/** Steps simple enough that a smaller model is worth evaluating. */
const SIMPLE_GROUPS = new Set(['compose', 'interpret', 'route']);
const CHEAP_MODEL = 'claude-haiku-5-5';
const MIN_CALLS = 10;

const pct = (x: number) => `${String(Math.round(x * 100))} %`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (micros: number) => `US$${(micros / 1e6).toFixed(2)}`;

function priced(s: StepUsage, model: string): number | null {
  return costUsdMicros(model, {
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadInputTokens: s.cachedTokens,
    cacheCreationInputTokens: 0,
  });
}

export function detectInsights(r: UsageReport): Insight[] {
  const out: Insight[] = [];
  const per30 = (micros: number) => (micros / r.days) * 30;

  for (const s of r.steps) {
    const key = `${s.group}:${s.model}`;
    const limit = stepTimeoutMs(s.group);
    if (s.calls >= 5 && s.p95Ms > limit * 0.6) {
      out.push({
        id: `timeout-risk:${key}`,
        kind: 'risk',
        title: `${s.group} on ${s.model} runs close to its timeout`,
        evidence: `p95 ${secs(s.p95Ms)} against a ${secs(limit)} limit (${String(s.calls)} calls, p50 ${secs(s.p50Ms)})`,
        action: `Route ${s.group} to a faster model, or shorten its prompt; set LLM_FALLBACK_MODEL so a timeout fails over`,
        savingUsdPer30Days: null,
        needsEval: true,
      });
    }
    if (s.calls >= MIN_CALLS && s.errors / s.calls > 0.05) {
      out.push({
        id: `errors:${key}`,
        kind: 'risk',
        title: `${s.model} fails often on ${s.group}`,
        evidence: `${String(s.errors)} of ${String(s.calls)} calls failed (${pct(s.errors / s.calls)})`,
        action:
          'Check llm_calls.error for the cause; set LLM_FALLBACK_MODEL so the circuit breaker can route around it',
        savingUsdPer30Days: null,
        needsEval: false,
      });
    }
    const avgInput = (s.inputTokens + s.cachedTokens) / Math.max(s.calls, 1);
    if (
      s.calls >= MIN_CALLS &&
      s.model.startsWith('claude-') &&
      avgInput > 1500 &&
      cacheShare(s) < 0.2
    ) {
      out.push({
        id: `cache:${key}`,
        kind: 'saving',
        title: `Prompt cache barely used on ${s.group}`,
        evidence: `${pct(cacheShare(s))} of input from cache, ${String(Math.round(avgInput))} input tokens per call`,
        action:
          'Keep the system prompt and tools identical between calls and put job-specific text last, so the prefix caches',
        savingUsdPer30Days: null,
        needsEval: false,
      });
    }
    const current = priced(s, s.model);
    const cheap = priced(s, CHEAP_MODEL);
    if (
      SIMPLE_GROUPS.has(s.group) &&
      s.calls >= MIN_CALLS &&
      s.model !== CHEAP_MODEL &&
      current !== null &&
      cheap !== null &&
      current - cheap > 0
    ) {
      out.push({
        id: `cheaper-model:${key}`,
        kind: 'saving',
        title: `${s.group} could run on ${CHEAP_MODEL}`,
        evidence: `${String(s.calls)} calls cost ${usd(current)}; the same tokens on ${CHEAP_MODEL} would cost ${usd(cheap)}`,
        action: `Run the eval with ${s.group} routed to anthropic:${CHEAP_MODEL}; if it holds, set LLM_STEP_MODELS=${s.group}=anthropic:${CHEAP_MODEL}`,
        savingUsdPer30Days: per30(current - cheap) / 1e6,
        needsEval: true,
      });
    }
  }

  const unpriced = r.steps.filter((s) => s.unpricedCalls > 0);
  if (unpriced.length) {
    const models = [...new Set(unpriced.map((s) => s.model))];
    out.push({
      id: 'unpriced',
      kind: 'info',
      title: 'Some model calls have no price',
      evidence: `${String(unpriced.reduce((n, s) => n + s.unpricedCalls, 0))} calls on ${models.join(', ')}`,
      action:
        'Add these models to LLM_PRICES_JSON so cost per job and the daily budget use real numbers',
      savingUsdPer30Days: null,
      needsEval: false,
    });
  }

  const candidates = r.repeatedShortReplies.filter(
    (x) => matchSlotChoice(x.text, 4) === null && matchConfirmation(x.text) === null,
  );
  if (candidates.length) {
    out.push({
      id: 'rule-candidates',
      kind: 'saving',
      title: 'Repeated short replies still go to the model',
      evidence: candidates
        .slice(0, 5)
        .map((c) => `"${c.text}" ×${String(c.count)}`)
        .join(', '),
      action:
        'Review whether any is unambiguous in every state; if so, add a layer-1 rule with tests (src/agent/fast-intents.ts)',
      savingUsdPer30Days: null,
      needsEval: true,
    });
  }
  return out;
}
