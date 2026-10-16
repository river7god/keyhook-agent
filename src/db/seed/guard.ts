const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/** Destructive dev scripts (seed/reset) refuse to touch anything but a local database. */
export function assertLocalDatabase(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run a destructive dev script with NODE_ENV=production');
  }
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run a destructive dev script against non-local host "${host}"`);
  }
  return url;
}
