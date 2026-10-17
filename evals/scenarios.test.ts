import { describe, expect, it } from 'vitest';
import { loadScenarios } from './run';

/** Audit actions a scenario may require or forbid (tool names + agent/job events). */
const KNOWN_ACTIONS = new Set([
  'get_property',
  'list_jobs_for_property',
  'search_tradies',
  'send_message',
  'request_quote',
  'schedule_visit',
  'request_approval',
  'approve_spend',
  'escalate',
  'add_note',
  'agent.triage',
  'agent.reassign',
  'agent.feedback',
  'job.transition',
  'job.escalation_package',
]);

describe('eval scenarios', () => {
  const scenarios = loadScenarios();

  it('meets the spec minimum of 50 reviewed scenarios (spec §4)', () => {
    expect(scenarios.filter((s) => s.reviewed).length).toBeGreaterThanOrEqual(50);
  });

  it('has unique ids', () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only references real audit actions', () => {
    for (const s of scenarios) {
      for (const a of [...s.expect.actions, ...s.expect.forbidden]) {
        expect(KNOWN_ACTIONS, `${s.id}: unknown action ${a}`).toContain(a);
      }
    }
  });

  it('covers every category in the spec §10 scenario mix', () => {
    const ids = scenarios.map((s) => s.id).join(' ');
    for (const tag of [
      'routine',
      'urgent',
      'emergency',
      'vague',
      'multi-issue',
      'angry',
      'tenant-caused',
      'over-budget',
      'unresponsive',
      'injection',
      'non-english',
    ]) {
      expect(ids, `no scenario for "${tag}"`).toContain(tag);
    }
  });

  it('states at least one expectation per scenario', () => {
    for (const s of scenarios) {
      const e = s.expect;
      const has =
        e.urgency ??
        e.trade ??
        e.escalate ??
        e.state ??
        e.estimateCents ??
        (e.actions.length || e.forbidden.length || undefined);
      expect(has, `${s.id} has no expectations`).toBeDefined();
    }
  });
});
