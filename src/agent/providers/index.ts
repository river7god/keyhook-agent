import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { organizations } from '@/db/schema';
import {
  AGENT_MODEL,
  ClaudeLlm,
  LlmConfigError,
  type LlmClient,
  type StructuredRequest,
  type ToolTurnRequest,
} from '../llm';
import { OpenAICompatibleLlm } from './openai-compatible';
import {
  llmRoutingSchema,
  parseModelRef,
  PROVIDERS,
  type LlmRouting,
  type ModelRef,
} from './registry';
import { breakerFor, shouldFailOver } from './resilience';

export const DEFAULT_MODEL: ModelRef = { provider: 'anthropic', model: AGENT_MODEL };

export function createLlmClient(db: DbOrTx, ref: ModelRef): LlmClient {
  const provider = PROVIDERS[ref.provider];
  if (provider.kind === 'anthropic') return new ClaudeLlm(db, undefined, ref.model);
  return new OpenAICompatibleLlm(db, provider, ref.model);
}

/**
 * Picks the model per step: exact step ("interpret.quote") → step group ("interpret") → default.
 * Clients are created lazily, so a missing key for an unused provider doesn't matter.
 *
 * With a `fallback` model configured, a call that fails for provider reasons (timeout, 5xx, 429,
 * auth/balance) is retried once on the fallback, and a provider whose circuit breaker is open is
 * skipped without waiting for it. A fixed --model override (evals) never fails over, so a score
 * always belongs to one model.
 */
export class RoutingLlm implements LlmClient {
  private clients = new Map<string, LlmClient>();

  constructor(
    private readonly db: DbOrTx,
    private readonly routing: LlmRouting | null,
    private readonly override: ModelRef | null = null,
    private readonly factory: (ref: ModelRef) => LlmClient = (ref) => createLlmClient(db, ref),
  ) {}

  resolve(step: string): ModelRef {
    if (this.override) return this.override;
    if (!this.routing) return DEFAULT_MODEL;
    const group = step.split('.')[0] as keyof LlmRouting['steps'];
    return this.routing.steps[group] ?? this.routing.default;
  }

  /** Models to try for a step, in order. */
  chain(step: string): ModelRef[] {
    const primary = this.resolve(step);
    const fallback = this.override ? undefined : this.routing?.fallback;
    return fallback && refKey(fallback) !== refKey(primary) ? [primary, fallback] : [primary];
  }

  private client(ref: ModelRef): LlmClient {
    const key = refKey(ref);
    let c = this.clients.get(key);
    if (!c) {
      c = this.factory(ref);
      this.clients.set(key, c);
    }
    return c;
  }

  private async run<R>(step: string, call: (c: LlmClient) => Promise<R>): Promise<R> {
    const chain = this.chain(step);
    let lastError: unknown;
    for (const [i, ref] of chain.entries()) {
      const last = i === chain.length - 1;
      const breaker = breakerFor(refKey(ref));
      if (!breaker.allow() && !last) {
        console.warn(`llm: ${refKey(ref)} circuit open, using ${refKey(chain[i + 1] ?? ref)}`);
        continue;
      }
      try {
        // Creating the client is inside the try: a missing key is a config error to fail over on.
        const result = await call(this.client(ref));
        breaker.success();
        return result;
      } catch (err) {
        if (!shouldFailOver(err)) throw err;
        breaker.failure();
        lastError = err;
        if (!last) console.warn(`llm: ${refKey(ref)} failed for ${step}, failing over`, err);
      }
    }
    throw lastError;
  }

  structured<T>(req: StructuredRequest<T>): Promise<T> {
    return this.run(req.ctx.step, (c) => c.structured(req));
  }

  toolTurn(req: ToolTurnRequest) {
    return this.run(req.ctx.step, (c) => c.toolTurn(req));
  }
}

const refKey = (ref: ModelRef) => `${ref.provider}:${ref.model}`;

/** The LLM an organization's jobs should use (validated routing config, Claude by default). */
export async function llmForOrganization(
  db: DbOrTx,
  organizationId: string,
  override: ModelRef | null = null,
): Promise<RoutingLlm> {
  const [org] = await db
    .select({ llmRouting: organizations.llmRouting })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org?.llmRouting) return new RoutingLlm(db, envDefaultRouting(), override);
  const parsed = llmRoutingSchema.safeParse(org.llmRouting);
  if (!parsed.success)
    throw new LlmConfigError(`Invalid llm_routing for organization: ${parsed.error.message}`);
  return new RoutingLlm(db, parsed.data, override);
}

/**
 * Deployment-wide default when an organization has no llm_routing:
 *   LLM_DEFAULT_MODEL=moonshot:<model id>   (provider:model)
 *   LLM_ACKNOWLEDGE_OFFSHORE=true            (required for deepseek / moonshot)
 *   LLM_SYNTHETIC_DATA_ONLY=true             (dev/demo/eval only: fictional data, so personal-data
 *                                            steps may use an acknowledged offshore provider)
 *   LLM_VISION_MODEL=provider:model          (optional: model for photo analysis)
 *   LLM_FALLBACK_MODEL=provider:model        (optional: used when the routed provider fails)
 *   LLM_STEP_MODELS=compose=anthropic:claude-haiku-5-5,interpret=anthropic:claude-haiku-5-5
 *                                            (optional: a model per step group, to save cost)
 * Unset → Claude everywhere.
 */
export function envDefaultRouting(): LlmRouting | null {
  const ref = process.env.LLM_DEFAULT_MODEL;
  const vision = process.env.LLM_VISION_MODEL;
  const fallback = process.env.LLM_FALLBACK_MODEL;
  const stepModels = process.env.LLM_STEP_MODELS;
  if (!ref && !vision && !fallback && !stepModels) return null;
  const parsed = llmRoutingSchema.safeParse({
    default: ref ? parseModelRef(ref) : DEFAULT_MODEL,
    steps: {
      ...parseStepModels(stepModels ?? ''),
      ...(vision ? { vision: parseModelRef(vision) } : {}),
    },
    ...(fallback ? { fallback: parseModelRef(fallback) } : {}),
    acknowledgeOffshoreProviders: process.env.LLM_ACKNOWLEDGE_OFFSHORE === 'true',
    syntheticDataOnly: process.env.LLM_SYNTHETIC_DATA_ONLY === 'true',
  });
  if (!parsed.success)
    throw new LlmConfigError(`Invalid LLM_* model settings: ${parsed.error.message}`);
  return parsed.data;
}

/** "compose=anthropic:claude-haiku-5-5,interpret=…" → { compose: ModelRef, interpret: ModelRef }. */
export function parseStepModels(text: string): Record<string, ModelRef> {
  const out: Record<string, ModelRef> = {};
  for (const pair of text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq <= 0)
      throw new LlmConfigError(`LLM_STEP_MODELS: expected step=provider:model, got "${pair}"`);
    out[pair.slice(0, eq).trim()] = parseModelRef(pair.slice(eq + 1).trim());
  }
  return out;
}
