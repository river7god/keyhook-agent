import { sql } from 'drizzle-orm';
import { createDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { testDatabaseUrl } from './db';

/** Rebuild the test database from migrations once per `vitest` run. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const { db, close } = createDb(url, { max: 1 });
  try {
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
  } finally {
    await close();
  }
  await runMigrations(url);
}
