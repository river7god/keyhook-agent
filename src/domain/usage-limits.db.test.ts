import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { llmCalls } from '@/db/schema';
import { currentTenancyFor, primaryTenantFor } from '@/db/seed/data/tenancies';
import { ORG, PROPERTY } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { closeTestDb, testDb } from '@/test/db';
import { ingestMessage } from './inbound';
import { assertSimulatorAllowance } from './usage-limits';

const db = testDb();
const org = ORG.harbourCity;
const tenantId = primaryTenantFor(currentTenancyFor(PROPERTY.newtown).id);

beforeEach(async () => {
  await seed(db);
});
afterEach(() => {
  delete process.env.SIMULATOR_MAX_MESSAGES_PER_HOUR;
  delete process.env.DAILY_LLM_BUDGET_USD;
});
afterAll(async () => {
  await closeTestDb();
});

describe('simulator allowance', () => {
  it('limits inbound messages per hour', async () => {
    process.env.SIMULATOR_MAX_MESSAGES_PER_HOUR = '2';
    await ingestMessage(db, {
      organizationId: org,
      senderType: 'tenant',
      senderId: tenantId,
      body: 'one',
    });
    await expect(assertSimulatorAllowance(db, org, new Date())).resolves.toBeUndefined();
    await ingestMessage(db, {
      organizationId: org,
      senderType: 'tenant',
      senderId: tenantId,
      body: 'two',
    });
    await expect(assertSimulatorAllowance(db, org, new Date())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('stops new simulator traffic once the daily AI budget is spent', async () => {
    process.env.DAILY_LLM_BUDGET_USD = '1';
    await db
      .insert(llmCalls)
      .values({
        organizationId: org,
        step: 'x',
        requestedModel: 'm',
        latencyMs: 1,
        costUsdMicros: 1_000_001,
      });
    await expect(assertSimulatorAllowance(db, org, new Date())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(assertSimulatorAllowance(db, ORG.aroValley, new Date())).resolves.toBeUndefined();
  });
});
