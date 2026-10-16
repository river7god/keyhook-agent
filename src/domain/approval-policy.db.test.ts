import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, testDb, truncateAll } from '@/test/db';
import { createOrgGraph } from '@/test/fixtures';
import { loadApprovalLimits } from './approval-policy';
import { DomainError } from './errors';

const db = testDb();

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await closeTestDb();
});

describe('loadApprovalLimits', () => {
  it('returns PM, org default and owner limits for a property', async () => {
    const g = await createOrgGraph(db, {
      orgDefaultLimitCents: 25_000,
      pmLimitCents: 40_000,
      ownerLimitCents: 90_000,
    });
    await expect(loadApprovalLimits(db, g.org.id, g.property.id)).resolves.toEqual({
      pmLimitCents: 40_000,
      orgDefaultPmLimitCents: 25_000,
      ownerLimitCents: 90_000,
    });
  });

  it('does not leak a property across organizations', async () => {
    const a = await createOrgGraph(db);
    const b = await createOrgGraph(db);
    await expect(loadApprovalLimits(db, a.org.id, b.property.id)).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
