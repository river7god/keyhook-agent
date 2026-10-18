import type { ActorType } from '@/db/schema';
import { ARREARS_TERMINAL, type ArrearsState } from './arrears-states';

/**
 * Arrears state machine (spec §12 R8) — the source of truth for case transitions, like the job
 * state machine (CLAUDE.md rule 1). The model never names a state.
 *
 *   OPEN → REMINDED → PROMISED ⇄ REMINDED (promise broken)
 *   REMINDED | PROMISED → NOTICE_PENDING (PM approves the formal notice) → NOTICE_SENT
 *   any open state → ESCALATED (a person decides) · RESOLVED (paid up) · CLOSED (PM only)
 */
const FLOW: Readonly<Partial<Record<ArrearsState, readonly ArrearsState[]>>> = {
  OPEN: ['REMINDED', 'PROMISED'],
  REMINDED: ['PROMISED', 'NOTICE_PENDING'],
  PROMISED: ['REMINDED', 'NOTICE_PENDING'],
  NOTICE_PENDING: ['NOTICE_SENT', 'PROMISED'],
  NOTICE_SENT: ['PROMISED'],
};

export type ArrearsTransitionCheck = { ok: true } | { ok: false; reason: string };

export function isArrearsTerminal(state: ArrearsState): boolean {
  return ARREARS_TERMINAL.includes(state);
}

export function checkArrearsTransition(
  from: ArrearsState,
  to: ArrearsState,
  ctx: { actor: ActorType; stateBeforeEscalation?: ArrearsState | null },
): ArrearsTransitionCheck {
  if (from === to) return { ok: false, reason: `Case is already ${from}` };
  if (isArrearsTerminal(from)) return { ok: false, reason: `${from} is terminal` };
  if (to === 'CLOSED') {
    return ctx.actor === 'pm' ? { ok: true } : { ok: false, reason: 'Only a PM can close a case' };
  }
  if (to === 'RESOLVED' || to === 'ESCALATED') return { ok: true };
  if (from === 'ESCALATED') {
    if (ctx.actor !== 'pm') return { ok: false, reason: 'Only a PM can resolve an escalation' };
    return to === ctx.stateBeforeEscalation
      ? { ok: true }
      : { ok: false, reason: 'An escalated case can only be handed back to its previous state' };
  }
  return FLOW[from]?.includes(to)
    ? { ok: true }
    : { ok: false, reason: `${from} → ${to} is not an allowed transition` };
}
