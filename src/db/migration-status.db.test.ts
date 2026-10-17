import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, testDb } from '@/test/db';
import { migrationStatus } from './migration-status';

afterAll(async () => {
  await closeTestDb();
});

describe('migrationStatus', () => {
  it('reports no pending migrations on a fully migrated database', async () => {
    const s = await migrationStatus(testDb());
    expect(s.expected).toBeGreaterThan(0);
    expect(s).toMatchObject({ pending: 0, applied: s.expected });
  });
});
