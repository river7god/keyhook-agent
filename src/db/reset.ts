import { sql } from 'drizzle-orm';
import { createDb } from './client';
import { assertLocalDatabase } from './seed/guard';

/** Drop everything (including drizzle's migration journal). `pnpm db:reset` then migrates + seeds. */
const { db, close } = createDb(assertLocalDatabase(process.env.DATABASE_URL), { max: 1 });
try {
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  console.log('Database dropped.');
} finally {
  await close();
}
