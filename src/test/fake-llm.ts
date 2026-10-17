import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, StructuredRequest, ToolTurnRequest } from '@/agent/llm';

type StructuredHandler = (req: StructuredRequest<unknown>) => unknown;
type ToolTurnHandler = (req: ToolTurnRequest, turn: number) => Anthropic.Beta.BetaContentBlock[];

/**
 * Deterministic LLM for tests. Each step name maps to a handler; an unexpected step fails the
 * test loudly. Structured outputs are validated against the real schema, so a fake that drifts
 * from the schema breaks just like the model would.
 */
export class ScriptedLlm implements LlmClient {
  readonly calls: { step: string; kind: 'structured' | 'toolTurn' }[] = [];
  private turns = new Map<string, number>();

  constructor(
    private readonly structuredHandlers: Record<string, StructuredHandler>,
    private readonly toolHandlers: Record<string, ToolTurnHandler> = {},
  ) {}

  structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.calls.push({ step: req.ctx.step, kind: 'structured' });
    const handler = this.structuredHandlers[req.ctx.step];
    if (!handler) throw new Error(`ScriptedLlm: no structured handler for step "${req.ctx.step}"`);
    return Promise.resolve(req.schema.parse(handler(req as StructuredRequest<unknown>)));
  }

  toolTurn(req: ToolTurnRequest): Promise<Anthropic.Beta.BetaMessage> {
    this.calls.push({ step: req.ctx.step, kind: 'toolTurn' });
    const handler = this.toolHandlers[req.ctx.step];
    if (!handler) throw new Error(`ScriptedLlm: no tool handler for step "${req.ctx.step}"`);
    const turn = this.turns.get(req.ctx.step) ?? 0;
    this.turns.set(req.ctx.step, turn + 1);
    const content = handler(req, turn);
    return Promise.resolve(fakeMessage(content));
  }
}

export function toolUse(
  name: string,
  input: unknown,
  id = `toolu_${name}_${Math.random().toString(36).slice(2, 8)}`,
) {
  return { type: 'tool_use', id, name, input } as unknown as Anthropic.Beta.BetaContentBlock;
}

export function text(t: string) {
  return { type: 'text', text: t, citations: null } as unknown as Anthropic.Beta.BetaContentBlock;
}

/** Last tool_result payload the model received, parsed. */
export function lastToolResult(req: ToolTurnRequest): Record<string, unknown> {
  const last = req.messages.at(-1);
  if (!last || !Array.isArray(last.content)) throw new Error('no tool result');
  const block = last.content.find((b) => b.type === 'tool_result');
  if (block?.type !== 'tool_result' || typeof block.content !== 'string') {
    throw new Error('no tool result');
  }
  return JSON.parse(block.content) as Record<string, unknown>;
}

function fakeMessage(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content,
    stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}
