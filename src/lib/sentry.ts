/** Sentry is optional: everything here is a no-op unless SENTRY_DSN is set. */
let initialised = false;

export async function initSentry(): Promise<void> {
  if (initialised || !process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    enableOpenTelemetrySetup: false,
    tracesSampleRate: 0,
    // Tenant messages and PM sessions must never reach the error tracker.
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) delete event.request.headers.cookie;
      }
      delete event.user;
      return event;
    },
  });
  initialised = true;
}

/** Report an error that was handled (e.g. a job escalated after retries) without rethrowing. */
export async function reportError(error: unknown, context: Record<string, string>): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  await initSentry();
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureException(error, { tags: context });
}
