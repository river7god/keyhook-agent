import { sql } from 'drizzle-orm';
import type { DbOrTx } from './client';

/** TRUNCATE every table in `public`. Dev/test only — bypasses the audit_log row trigger. */
export async function truncateAllTables(db: DbOrTx): Promise<void> {
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
