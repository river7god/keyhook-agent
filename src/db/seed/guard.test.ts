import { afterEach, describe, expect, it } from 'vitest';
import { usesTransactionPooler } from '../client';
import { assertLocalDatabase } from './guard';

const remote = 'postgres://u:p@ep-cool-123-pooler.ap-southeast-2.aws.neon.tech/db';

afterEach(() => {
  delete process.env.ALLOW_REMOTE_SEED;
  delete process.env.SEED_PM_PASSWORD;
});

describe('seed guard', () => {
  it('allows local databases', () => {
    expect(assertLocalDatabase('postgres://u:p@localhost:54329/k')).toContain('localhost');
  });

  it('refuses remote databases by default and for reset', () => {
    expect(() => assertLocalDatabase(remote)).toThrow(/non-local/);
    process.env.ALLOW_REMOTE_SEED = 'true';
    process.env.SEED_PM_PASSWORD = 'a-long-demo-password';
    expect(() => assertLocalDatabase(remote)).toThrow(/non-local/); // reset never opts in
  });

  it('allows a remote demo seed only with the flag and a strong password', () => {
    process.env.ALLOW_REMOTE_SEED = 'true';
    expect(() => assertLocalDatabase(remote, { allowRemoteSeed: true })).toThrow(
      /SEED_PM_PASSWORD/,
    );
    process.env.SEED_PM_PASSWORD = 'keyhook-demo';
    expect(() => assertLocalDatabase(remote, { allowRemoteSeed: true })).toThrow(
      /SEED_PM_PASSWORD/,
    );
    process.env.SEED_PM_PASSWORD = 'a-long-demo-password';
    expect(assertLocalDatabase(remote, { allowRemoteSeed: true })).toBe(remote);
  });
});

describe('usesTransactionPooler', () => {
  it('detects Neon pooled hosts', () => {
    expect(usesTransactionPooler(remote)).toBe(true);
    expect(
      usesTransactionPooler('postgres://u:p@ep-cool-123.ap-southeast-2.aws.neon.tech/db'),
    ).toBe(false);
  });
});
