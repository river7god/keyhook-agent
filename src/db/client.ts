import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '@/lib/env';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;
/** A transaction handle is usable anywhere a Db is. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(
  url: string,
  options: { max?: number } = {},
): {
  db: Db;
  close: () => Promise<void>;
} {
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
    // PgBouncer in transaction mode (e.g. Neon's "-pooler" host) can't use prepared statements.
    prepare: !usesTransactionPooler(url),
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, close: () => sql.end() };
}

let appDb: Db | undefined;

/** Process-wide connection pool for the Next.js app and Inngest functions. */
export function getDb(): Db {
  appDb ??= createDb(getEnv().DATABASE_URL).db;
  return appDb;
}

export function usesTransactionPooler(url: string): boolean {
  if (process.env.DATABASE_PREPARE === 'false') return true;
  return new URL(url).hostname.includes('-pooler.');
}
