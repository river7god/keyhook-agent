import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { advanceJob } from '@/agent/advance';
import { seed } from '@/db/seed/seed';
import { db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { agentStats } from './agent-stats';
import { scanRepeatedFaults } from './portfolio-monitor';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

describe('agentStats', () => {
  it('counts what each live agent did in the window', async () => {
    const m = await say('tenant', tenantId, 'No hot water');
    await advanceJob(deps(happyLlm()), {
      organizationId: org,
      jobId: m.jobId,
      messageId: m.messageId,
    });
    await scanRepeatedFaults(db, org, now);

    const s = await agentStats(db, org, now);
    expect(s.maintenance.open).toBe(1);
    expect(s.maintenance.escalated).toBe(0);
    expect(s.updates.sent).toBe(2); // acknowledgement + quote requested
    expect(s.monitor.open).toBeGreaterThanOrEqual(1);
    // Seeded closed jobs are months old: outside the 30-day window.
    expect(s.maintenance.closed).toBe(0);
  });
});
