import { describe, expect, it } from 'vitest';
import { JOB_STATES, type JobState } from './job-states';
import { allowedTransitions, checkTransition } from './state-machine';

const agent = { actor: 'agent' } as const;
const pm = { actor: 'pm' } as const;

describe('happy path (spec §5)', () => {
  const path: JobState[] = [
    'RECEIVED',
    'TRIAGED',
    'AWAITING_QUOTE',
    'AWAITING_APPROVAL',
    'SCHEDULING',
    'SCHEDULED',
    'IN_PROGRESS',
    'AWAITING_CONFIRMATION',
    'CLOSED',
  ];
  it.each(path.slice(0, -1).map((from, i) => [from, path[i + 1] as JobState]))(
    '%s → %s is allowed for the agent',
    (from, to) => {
      expect(checkTransition(from, to, agent)).toEqual({ ok: true });
    },
  );

  it('allows skipping approval (AWAITING_QUOTE → SCHEDULING)', () => {
    expect(checkTransition('AWAITING_QUOTE', 'SCHEDULING', agent).ok).toBe(true);
  });

  it('allows the clarifying-question loop', () => {
    expect(checkTransition('TRIAGED', 'NEEDS_INFO', agent).ok).toBe(true);
    expect(checkTransition('NEEDS_INFO', 'TRIAGED', agent).ok).toBe(true);
  });
});

describe('disallowed transitions', () => {
  it.each([
    ['RECEIVED', 'SCHEDULED'],
    ['TRIAGED', 'CLOSED'],
    ['NEEDS_INFO', 'AWAITING_QUOTE'],
    ['AWAITING_APPROVAL', 'SCHEDULED'],
    ['SCHEDULED', 'TRIAGED'],
  ] as const)('%s → %s is rejected', (from, to) => {
    expect(checkTransition(from, to, agent).ok).toBe(false);
  });

  it('rejects self-transitions', () => {
    for (const s of JOB_STATES) expect(checkTransition(s, s, pm).ok).toBe(false);
  });

  it('never leaves a terminal state', () => {
    for (const from of ['CLOSED', 'CANCELLED'] as const) {
      expect(allowedTransitions(from, pm)).toEqual([]);
    }
  });
});

describe('escalation', () => {
  it('lets anyone escalate from any non-terminal state', () => {
    for (const from of JOB_STATES) {
      if (from === 'ESCALATED' || from === 'CLOSED' || from === 'CANCELLED') continue;
      expect(checkTransition(from, 'ESCALATED', agent).ok).toBe(true);
    }
  });

  it('only lets a PM hand back, and only to the recorded prior state', () => {
    const ctx = { stateBeforeEscalation: 'AWAITING_QUOTE' } as const;
    expect(checkTransition('ESCALATED', 'AWAITING_QUOTE', { ...pm, ...ctx }).ok).toBe(true);
    expect(checkTransition('ESCALATED', 'AWAITING_QUOTE', { ...agent, ...ctx }).ok).toBe(false);
    expect(checkTransition('ESCALATED', 'SCHEDULING', { ...pm, ...ctx }).ok).toBe(false);
    expect(checkTransition('ESCALATED', 'AWAITING_QUOTE', pm).ok).toBe(false);
  });
});

describe('cancellation', () => {
  it('is PM-only', () => {
    expect(checkTransition('TRIAGED', 'CANCELLED', agent).ok).toBe(false);
    expect(checkTransition('TRIAGED', 'CANCELLED', pm).ok).toBe(true);
    expect(checkTransition('ESCALATED', 'CANCELLED', pm).ok).toBe(true);
  });
});

describe('allowedTransitions (the menu the LLM sees)', () => {
  it('offers the agent only flow states + ESCALATED, never CANCELLED', () => {
    expect(allowedTransitions('TRIAGED', agent)).toEqual([
      'NEEDS_INFO',
      'AWAITING_QUOTE',
      'ESCALATED',
    ]);
  });

  it('offers the agent nothing on an escalated job', () => {
    expect(allowedTransitions('ESCALATED', { ...agent, stateBeforeEscalation: 'TRIAGED' })).toEqual(
      [],
    );
  });
});
