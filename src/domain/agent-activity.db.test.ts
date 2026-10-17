import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { advanceJob } from '@/agent/advance';
import { seed } from '@/db/seed/seed';
import { db, deps, happyLlm, now, org, say, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { getAgentActivity } from './agent-activity';
import { getJob } from './jobs';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

const later = (ms: number) => new Date(Date.now() + ms);

describe('getAgentActivity', () => {
  it('is working right after a tenant message, and stalls if nothing happens', async () => {
    const m = await say('tenant', tenantId, 'No hot water');
    const job = await getJob(db, org, m.jobId);
    const fresh = await getAgentActivity(db, job, later(1_000));
    expect(fresh).toMatchObject({
      working: true,
      stalled: false,
      lastStep: 'Received the request',
    });
    expect((await getAgentActivity(db, job, later(4 * 60_000))).stalled).toBe(true);
  });

  it('is idle once the agent has handled the message and is waiting on the tradie', async () => {
    const m = await say('tenant', tenantId, 'No hot water');
    await advanceJob(deps(happyLlm()), {
      organizationId: org,
      jobId: m.jobId,
      messageId: m.messageId,
    });
    const job = await getJob(db, org, m.jobId);
    const a = await getAgentActivity(db, job, later(10 * 60_000));
    expect(job.state).toBe('AWAITING_QUOTE');
    expect(a).toMatchObject({ working: false, stalled: false, waitingSince: null });
    expect(a.lastStep).not.toBeNull();
  });

  it('is working again when a reply arrives that has not been processed', async () => {
    const m = await say('tenant', tenantId, 'No hot water');
    await advanceJob(deps(happyLlm()), {
      organizationId: org,
      jobId: m.jobId,
      messageId: m.messageId,
    });
    const job = await getJob(db, org, m.jobId);
    await say('tradie', job.assignedTradieId as string, '$185 incl GST', job.id);
    expect((await getAgentActivity(db, job, later(1_000))).working).toBe(true);
  });
});
