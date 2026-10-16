import { expect } from 'vitest';

interface PgErrorLike {
  code?: string;
  constraint_name?: string;
  message?: string;
}

/** Drizzle wraps driver errors; the postgres.js error is on `.cause`. */
function pgErrorOf(err: unknown): PgErrorLike {
  if (
    err &&
    typeof err === 'object' &&
    'cause' in err &&
    err.cause &&
    typeof err.cause === 'object'
  ) {
    return err.cause;
  }
  return err as PgErrorLike;
}

/** Assert the promise rejects with a Postgres error matching a constraint name or SQLSTATE. */
export async function expectPgError(
  promise: Promise<unknown>,
  match: { constraint?: string; code?: string },
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected a database error').toBeDefined();
  const pg = pgErrorOf(caught);
  if (match.constraint) expect(pg.constraint_name).toBe(match.constraint);
  if (match.code) expect(pg.code).toBe(match.code);
}
