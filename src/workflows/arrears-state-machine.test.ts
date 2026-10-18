import { describe, expect, it } from 'vitest';
import { checkArrearsTransition } from './arrears-state-machine';

const agent = { actor: 'agent' as const };

describe('arrears state machine', () => {
  it('allows the reminder → promise → notice path', () => {
    expect(checkArrearsTransition('OPEN', 'REMINDED', agent).ok).toBe(true);
    expect(checkArrearsTransition('REMINDED', 'PROMISED', agent).ok).toBe(true);
    expect(checkArrearsTransition('PROMISED', 'REMINDED', agent).ok).toBe(true);
    expect(checkArrearsTransition('REMINDED', 'NOTICE_PENDING', agent).ok).toBe(true);
    expect(checkArrearsTransition('NOTICE_PENDING', 'NOTICE_SENT', agent).ok).toBe(true);
  });

  it('never lets the agent skip the approval step or close a case', () => {
    expect(checkArrearsTransition('REMINDED', 'NOTICE_SENT', agent).ok).toBe(false);
    expect(checkArrearsTransition('OPEN', 'NOTICE_PENDING', agent).ok).toBe(false);
    expect(checkArrearsTransition('REMINDED', 'CLOSED', agent).ok).toBe(false);
    expect(checkArrearsTransition('REMINDED', 'CLOSED', { actor: 'pm' }).ok).toBe(true);
  });

  it('resolves or escalates from any open state, and only a PM hands back', () => {
    expect(checkArrearsTransition('NOTICE_SENT', 'RESOLVED', agent).ok).toBe(true);
    expect(checkArrearsTransition('PROMISED', 'ESCALATED', agent).ok).toBe(true);
    expect(checkArrearsTransition('ESCALATED', 'REMINDED', agent).ok).toBe(false);
    expect(
      checkArrearsTransition('ESCALATED', 'REMINDED', {
        actor: 'pm',
        stateBeforeEscalation: 'REMINDED',
      }).ok,
    ).toBe(true);
    expect(checkArrearsTransition('RESOLVED', 'REMINDED', { actor: 'pm' }).ok).toBe(false);
  });
});
