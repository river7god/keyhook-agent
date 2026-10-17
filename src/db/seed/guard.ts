const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/**
 * Destructive dev scripts (seed/reset) refuse anything but a local database. Seeding a hosted
 * demo database is allowed only with ALLOW_REMOTE_SEED=true and a non-default SEED_PM_PASSWORD of
 * at least 12 characters (seeding wipes every table first). Reset is never allowed remotely.
 */
export function assertLocalDatabase(
  url: string | undefined,
  opts: { allowRemoteSeed?: boolean } = {},
): string {
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  if (LOCAL_HOSTS.has(host)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to run a destructive dev script with NODE_ENV=production');
    }
    return url;
  }
  if (opts.allowRemoteSeed && process.env.ALLOW_REMOTE_SEED === 'true') {
    const pw = process.env.SEED_PM_PASSWORD ?? '';
    if (pw.length < 12 || pw === 'keyhook-demo') {
      throw new Error('Remote seed needs SEED_PM_PASSWORD (12+ chars, not the dev default)');
    }
    console.warn(`ALLOW_REMOTE_SEED: wiping and seeding demo data on ${host}`);
    return url;
  }
  throw new Error(`Refusing to run a destructive dev script against non-local host "${host}"`);
}
