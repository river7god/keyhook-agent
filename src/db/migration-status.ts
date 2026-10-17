import { sql } from 'drizzle-orm';
import journal from './migrations/meta/_journal.json';
import type { DbOrTx } from './client';

/**
 * Compare the migrations this build ships with what the database has applied. A deploy whose
 * code is ahead of its database (migrations not run) shows up here instead of as random 500s.
 */
export async function migrationStatus(db: DbOrTx) {
  const expected = journal.entries.length;
  let applied = 0;
  try {
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    applied = rows[0]?.n ?? 0;
  } catch {
    applied = 0; // migrations table missing → nothing applied
  }
  return {
    expected,
    applied,
    pending: Math.max(0, expected - applied),
    latest: journal.entries.at(-1)?.tag ?? null,
  };
}
