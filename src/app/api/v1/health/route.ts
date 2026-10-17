import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { migrationStatus } from '@/db/migration-status';
import { ok, toErrorResponse } from '../_lib/respond';

export const dynamic = 'force-dynamic';

/** Liveness + schema check. 503 when the database is behind this build's migrations. */
export async function GET() {
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const migrations = await migrationStatus(db);
    const healthy = migrations.pending === 0;
    return ok(
      {
        status: healthy ? 'ok' : 'degraded',
        db: 'ok',
        migrations,
        ...(healthy
          ? {}
          : { action: 'Run migrations against this database (docs/deploy.md step 2)' }),
        time: new Date().toISOString(),
      },
      { status: healthy ? 200 : 503 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
