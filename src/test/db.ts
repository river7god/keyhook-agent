import { sql } from 'drizzle-orm';
import { createDb, type Db } from '@/db/client';

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set (see .env.example)');
  if (!/\/[\w-]*test[\w-]*(\?|$)/.test(url)) {
    throw new Error(`Refusing to run DB tests against a non-test database: ${url}`);
  }
  return url;
}

let handle: ReturnType<typeof createDb> | undefined;

export function testDb(): Db {
  handle ??= createDb(testDatabaseUrl(), { max: 2 });
  return handle.db;
}

export async function closeTestDb(): Promise<void> {
  await handle?.close();
  handle = undefined;
}

/** Wipe every table in public (TRUNCATE bypasses the audit_log row trigger by design). */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE stmt text;
    BEGIN
      SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' RESTART IDENTITY CASCADE'
        INTO stmt FROM pg_tables WHERE schemaname = 'public';
      IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
    END $$;
  `);
}
