import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { idempotencyKeys } from '@/db/schema';
import { DomainError } from './errors';

/** JSON with recursively sorted keys, so semantically equal requests hash equally. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function hashRequest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * Run `effect` at most once per (organization, key) — rule 3.
 * Must be called inside the same transaction as the effect, so the key and the effect commit
 * together. A concurrent duplicate blocks on the primary key until the first commits, then
 * returns the stored response.
 */
export async function withIdempotency<T>(
  tx: DbOrTx,
  args: { organizationId: string; key: string; tool: string; request: unknown },
  effect: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const requestHash = hashRequest(args.request);
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({
      organizationId: args.organizationId,
      key: args.key,
      tool: args.tool,
      requestHash,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (inserted.length === 0) {
    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.organizationId, args.organizationId),
          eq(idempotencyKeys.key, args.key),
        ),
      );
    if (!existing) throw new DomainError('CONFLICT', 'Idempotency key vanished', { key: args.key });
    if (existing.tool !== args.tool || existing.requestHash !== requestHash) {
      throw new DomainError(
        'IDEMPOTENCY_MISMATCH',
        'Idempotency key reused with a different request',
        {
          key: args.key,
          tool: args.tool,
        },
      );
    }
    if (existing.completedAt === null) {
      throw new DomainError('CONFLICT', 'Request with this idempotency key is still in progress', {
        key: args.key,
      });
    }
    return { result: existing.response as T, replayed: true };
  }

  const result = await effect();
  await tx
    .update(idempotencyKeys)
    .set({ response: result, completedAt: sql`now()` })
    .where(
      and(
        eq(idempotencyKeys.organizationId, args.organizationId),
        eq(idempotencyKeys.key, args.key),
      ),
    );
  return { result, replayed: false };
}
