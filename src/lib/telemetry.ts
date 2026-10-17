import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

/**
 * OpenTelemetry tracing (decisions.md: "Tracing via OTLP"). Exports only when an OTLP endpoint is
 * configured through the standard env vars, e.g. for Langfuse:
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces
 *   OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Basic <base64(publicKey:secretKey)>
 * With nothing configured, spans are no-ops.
 */
let provider: NodeTracerProvider | null = null;

export function registerTelemetry(): boolean {
  if (provider) return true;
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return false;
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'keyhook-agent',
      'deployment.environment.name': process.env.NODE_ENV,
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  return true;
}

export async function flushTelemetry(): Promise<void> {
  await provider?.forceFlush();
}

export const tracer = trace.getTracer('keyhook-agent');

/** Run `fn` inside an active span; records exceptions and always ends the span. */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Trace id of the active span, for linking audit rows to traces. */
export function activeTraceId(): string | null {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && trace.isSpanContextValid(ctx) ? ctx.traceId : null;
}
