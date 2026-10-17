import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from './client';

/**
 * Run request-scoped work under row-level security: one transaction, `SET LOCAL ROLE keyhook_app`
 * and `app.organization_id`. Every table query inside is filtered to that organization by
 * Postgres itself (migration 0007), on top of the explicit organizationId filters in code.
 * Keep these transactions short — never call the LLM inside one.
 */
export async function withOrg<T>(
  db: Db,
  organizationId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const orgId = z.uuid().parse(organizationId);
  return db.transaction(async (tx) => {
    // One round trip: set_config('role', …, true) is SET LOCAL ROLE.
    await tx.execute(
      sql`select set_config('app.organization_id', ${orgId}, true), set_config('role', 'keyhook_app', true)`,
    );
    return fn(tx);
  });
}
