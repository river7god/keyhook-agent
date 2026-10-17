import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { advanceJob } from '@/agent/advance';
import { handBackJob } from '@/agent/pm-actions';
import { PM } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { recordFeedback } from '@/domain/feedback';
import { cleanTriage, db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { harvest, redact } from './harvest';
import { loadScenarios, scenarioSchema } from './run';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

describe('eval harvest', () => {
  it('turns a PM correction into an unreviewed, runnable scenario — once', async () => {
    const llm = happyLlm({
      triage: () => ({
        ...cleanTriage,
        urgency: 'emergency',
        flags: { ...cleanTriage.flags, emergencySignals: true },
      }),
    });
    const m = await say(
      'tenant',
      tenantId,
      'Hi it is Ana Tuilagi on 021 000 1002 — the hot water cylinder is hissing',
    );
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    await handBackJob(db, {
      organizationId: org,
      jobId: m.jobId,
      propertyManagerId: PM.aroha,
      note: null,
      urgency: 'urgent',
      trade: null,
      now,
    });
    await recordFeedback(db, {
      organizationId: org,
      jobId: m.jobId,
      propertyManagerId: PM.aroha,
      input: {
        kind: 'should_not_have_escalated',
        expectedUrgency: null,
        expectedTrade: null,
        note: 'Hissing is normal venting',
      },
    });

    const out = mkdtempSync(path.join(tmpdir(), 'harvest-'));
    const r = await harvest(db, out, now);
    expect(r.skipped).toEqual([]);
    expect(r.written).toHaveLength(2);

    const scenarios = r.written.map((f) => scenarioSchema.parse(parse(readFileSync(f, 'utf8'))));
    const urgency = scenarios.find((s) => s.expect.urgency);
    expect(urgency).toMatchObject({
      reviewed: false,
      property: 'newtown',
      expect: { urgency: ['urgent'] },
    });
    expect(urgency?.steps?.[0]).toEqual({
      tenant: 'Hi it is [name] on [phone] — the hot water cylinder is hissing',
    });
    expect(scenarios.find((s) => s.expect.escalate === false)).toBeDefined();

    // Loadable by the runner from that directory, and harvested only once.
    expect(loadScenarios(out)).toHaveLength(2);
    expect((await harvest(db, out, now)).written).toHaveLength(0);
  });

  it('redacts emails, phone numbers and known names (full name first, then parts)', () => {
    expect(redact('Thanks Sarah', ['Sarah O’Brien'])).toBe('Thanks [name]');
    expect(
      redact('Call Sarah O’Brien at +64 21 555 0199 or sarah@example.com', ['Sarah O’Brien']),
    ).toBe('Call [name] at [phone] or [email]');
  });
});
