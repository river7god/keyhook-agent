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
