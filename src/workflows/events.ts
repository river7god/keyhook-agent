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

/** A follow-up is due (emitted by the sweeper; event id dedupes repeats). */
export const followUpDue = eventType('followup/due', {
  schema: z.object({ ...orgScoped, jobId: z.uuid(), followUpId: z.uuid() }),
});

/** An arrears case may progress: a tenant replied, or a PM decided (spec §12 R8). */
export const arrearsAdvanceRequested = eventType('arrears/advance.requested', {
  schema: z.object({ ...orgScoped, caseId: z.uuid(), messageId: z.uuid().nullable() }),
});

/** A tenant message arrived without a conversation and the tenant has an open arrears case. */
export const inboundRouteRequested = eventType('inbound/route.requested', {
  schema: z.object({ ...orgScoped, messageId: z.uuid() }),
});

/** Run the arrears sweep for one organization now (dashboard "Run arrears check"). */
export const arrearsSweepRequested = eventType('arrears/sweep.requested', {
  schema: z.object({ ...orgScoped }),
});
