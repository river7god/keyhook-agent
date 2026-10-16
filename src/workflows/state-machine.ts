import type { ActorType } from '@/db/schema';
import { JOB_STATES, TERMINAL_STATES, type JobState } from './job-states';

/**
 * Job state machine (spec §5). This is the source of truth for transitions (CLAUDE.md rule 1):
 * the LLM is only ever offered `allowedTransitions(...)` and every write goes through
 * `checkTransition(...)`. Never encode transitions in a prompt.
 */

/** Forward workflow edges. ESCALATED / CANCELLED are handled as cross-cutting rules below. */
const FLOW: Readonly<Partial<Record<JobState, readonly JobState[]>>> = {
  RECEIVED: ['TRIAGED'],
  TRIAGED: ['NEEDS_INFO', 'AWAITING_QUOTE'],
  NEEDS_INFO: ['TRIAGED'],
  // → SCHEDULING directly when the estimate is within the PM auto-approval limit.
  AWAITING_QUOTE: ['AWAITING_APPROVAL', 'SCHEDULING'],
  AWAITING_APPROVAL: ['SCHEDULING'],
  SCHEDULING: ['SCHEDULED'],
  SCHEDULED: ['IN_PROGRESS'],
  IN_PROGRESS: ['AWAITING_CONFIRMATION'],
  AWAITING_CONFIRMATION: ['CLOSED'],
};

export interface TransitionContext {
  actor: ActorType;
  /** Required when leaving ESCALATED: the only state a PM can hand the job back to. */
  stateBeforeEscalation?: JobState | null;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function isTerminal(state: JobState): boolean {
  return (TERMINAL_STATES as readonly JobState[]).includes(state);
}

export function checkTransition(
  from: JobState,
  to: JobState,
  ctx: TransitionContext,
): TransitionCheck {
  if (from === to) return { ok: false, reason: `Job is already ${from}` };
  if (isTerminal(from)) return { ok: false, reason: `${from} is terminal` };

  if (to === 'CANCELLED') {
    return ctx.actor === 'pm' ? { ok: true } : { ok: false, reason: 'Only a PM can cancel a job' };
  }

  if (to === 'ESCALATED') return { ok: true };

  if (from === 'ESCALATED') {
    if (ctx.actor !== 'pm') return { ok: false, reason: 'Only a PM can resolve an escalation' };
    if (!ctx.stateBeforeEscalation) {
      return { ok: false, reason: 'Escalated job has no recorded prior state' };
    }
    return to === ctx.stateBeforeEscalation
      ? { ok: true }
      : {
          ok: false,
          reason: `An escalated job can only be handed back to ${ctx.stateBeforeEscalation}`,
        };
  }

  return FLOW[from]?.includes(to)
    ? { ok: true }
    : { ok: false, reason: `Transition ${from} → ${to} is not allowed` };
}

/** Every state `actor` may move the job to from `from`. This is the menu offered to the LLM. */
export function allowedTransitions(from: JobState, ctx: TransitionContext): JobState[] {
  return JOB_STATES.filter((to) => checkTransition(from, to, ctx).ok);
}
