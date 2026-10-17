import { eventType } from 'inngest';
import { z } from 'zod';

/**
 * Every workflow event carries organizationId so functions never run outside a tenant scope.
 * Event names: "<domain>/<noun>.<verb>".
 */
const orgScoped = { organizationId: z.uuid() };

export const systemPing = eventType('system/ping.requested', {
  schema: z.object({ ...orgScoped, note: z.string().max(200).optional() }),
});

/** A job may be able to progress: it was just created, or a tenant/tradie message arrived. */
export const jobAdvanceRequested = eventType('job/advance.requested', {
  schema: z.object({ ...orgScoped, jobId: z.uuid(), messageId: z.uuid().nullable() }),
});
