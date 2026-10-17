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
import { llmRoutingSchema, PROVIDERS, type LlmRouting, type ModelRef } from './registry';

export const DEFAULT_MODEL: ModelRef = { provider: 'anthropic', model: AGENT_MODEL };

export function createLlmClient(db: DbOrTx, ref: ModelRef): LlmClient {
  const provider = PROVIDERS[ref.provider];
  if (provider.kind === 'anthropic') return new ClaudeLlm(db, undefined, ref.model);
  return new OpenAICompatibleLlm(db, provider, ref.model);
}

/**
 * Picks the model per step: exact step ("interpret.quote") → step group ("interpret") → default.
 * Clients are created lazily, so a missing key for an unused provider doesn't matter.
 */
export class RoutingLlm implements LlmClient {
  private clients = new Map<string, LlmClient>();

  constructor(
    private readonly db: DbOrTx,
    private readonly routing: LlmRouting | null,
    private readonly override: ModelRef | null = null,
  ) {}

  resolve(step: string): ModelRef {
    if (this.override) return this.override;
    if (!this.routing) return DEFAULT_MODEL;
    const group = step.split('.')[0] as keyof LlmRouting['steps'];
    return this.routing.steps[group] ?? this.routing.default;
  }

  private client(step: string): LlmClient {
    const ref = this.resolve(step);
    const key = `${ref.provider}:${ref.model}`;
    let c = this.clients.get(key);
    if (!c) {
      c = createLlmClient(this.db, ref);
      this.clients.set(key, c);
    }
    return c;
  }

  structured<T>(req: StructuredRequest<T>): Promise<T> {
    return this.client(req.ctx.step).structured(req);
  }

  toolTurn(req: ToolTurnRequest) {
    return this.client(req.ctx.step).toolTurn(req);
  }
}

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
  if (!org?.llmRouting) return new RoutingLlm(db, null, override);
  const parsed = llmRoutingSchema.safeParse(org.llmRouting);
  if (!parsed.success)
    throw new LlmConfigError(`Invalid llm_routing for organization: ${parsed.error.message}`);
  return new RoutingLlm(db, parsed.data, override);
}
