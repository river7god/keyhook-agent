import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { ok, toErrorResponse } from '../_lib/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return ok({ status: 'ok', db: 'ok', time: new Date().toISOString() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
