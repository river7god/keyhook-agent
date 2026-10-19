import { z } from 'zod';

/**
 * Model providers the agent can route to (decisions.md "Pluggable model providers").
 * API keys come only from environment variables — never from the database or config JSON.
 * `requiresAcknowledgement`: the provider stores/processes data in a jurisdiction the agency must
 * explicitly accept (NZ Privacy Act 2020, IPP 12 cross-border disclosure). Every provider here
 * processes data outside NZ; these are the ones flagged for an explicit opt-in.
 */
export const PROVIDER_IDS = ['anthropic', 'openai', 'deepseek', 'moonshot'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: 'anthropic' | 'openai-compatible';
  apiKeyEnv: string;
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
  /** Native JSON-Schema structured output; otherwise JSON mode + schema in the prompt + validation. */
  jsonSchemaOutput: boolean;
  /** Accepts `reasoning_effort`. */
  reasoningEffort: boolean;
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  requiresAcknowledgement: boolean;
  /** Accepts image input. Model-dependent within a provider; this is the provider default. */
  vision: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    jsonSchemaOutput: true,
    reasoningEffort: true,
    maxTokensParam: 'max_tokens',
    requiresAcknowledgement: false,
    vision: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    kind: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrlEnv: 'OPENAI_BASE_URL',
    jsonSchemaOutput: true,
    reasoningEffort: true,
    maxTokensParam: 'max_completion_tokens',
    requiresAcknowledgement: false,
    vision: true,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com',
    jsonSchemaOutput: false,
    reasoningEffort: false,
    maxTokensParam: 'max_tokens',
    requiresAcknowledgement: true,
    vision: false,
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    kind: 'openai-compatible',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    baseUrlEnv: 'MOONSHOT_BASE_URL',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    jsonSchemaOutput: false,
    reasoningEffort: false,
    maxTokensParam: 'max_tokens',
    requiresAcknowledgement: true,
    // Some Kimi models accept images; set MOONSHOT_VISION=true once the chosen model is verified.
    vision: process.env.MOONSHOT_VISION === 'true',
  },
};

export const modelRefSchema = z.strictObject({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().min(1).max(100),
});
export type ModelRef = z.infer<typeof modelRefSchema>;

/** Step groups that can be routed separately (first segment of LlmContext.step). */
export const STEP_GROUPS = ['triage', 'retriage', 'act', 'interpret', 'compose', 'vision'] as const;

/** organizations.llm_routing. Null/absent = Claude for every step. */
export const llmRoutingSchema = z
  .strictObject({
    default: modelRefSchema,
    steps: z.partialRecord(z.enum(STEP_GROUPS), modelRefSchema).default({}),
    /** Tried when the routed model fails for provider reasons (outage, timeout, 429, auth). */
    fallback: modelRefSchema.optional(),
    /** Must be true before any provider flagged requiresAcknowledgement is used. */
    acknowledgeOffshoreProviders: z.boolean().default(false),
  })
  .superRefine((cfg, ctx) => {
    const refs = [
      cfg.default,
      ...Object.values(cfg.steps),
      ...(cfg.fallback ? [cfg.fallback] : []),
    ];
    for (const r of refs) {
      if (PROVIDERS[r.provider].requiresAcknowledgement && !cfg.acknowledgeOffshoreProviders) {
        ctx.addIssue({
          code: 'custom',
          message: `${PROVIDERS[r.provider].label} requires acknowledgeOffshoreProviders: true (data leaves NZ; privacy assessment needed)`,
        });
      }
    }
  });
export type LlmRouting = z.infer<typeof llmRoutingSchema>;

/** "provider:model" → ModelRef (used by the eval CLI and env overrides). */
export function parseModelRef(text: string): ModelRef {
  const [provider, ...rest] = text.split(':');
  return modelRefSchema.parse({ provider, model: rest.join(':') });
}
