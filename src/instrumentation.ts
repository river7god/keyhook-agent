import type { Instrumentation } from 'next';

/**
 * Next.js startup hook (Node.js runtime): OpenTelemetry tracing (src/lib/telemetry.ts) and,
 * when SENTRY_DSN is set, Sentry error reporting. Sentry's own OpenTelemetry setup is disabled
 * so it doesn't replace our tracer provider; it reports errors only (no tracing, no PII).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { registerTelemetry } = await import('./lib/telemetry');
  registerTelemetry();
  const { initSentry } = await import('./lib/sentry');
  await initSentry();
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
