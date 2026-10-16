import { getDb } from '@/db/client';
import { writeAudit } from '@/domain/audit';
import { inngest } from '../client';
import { systemPing } from '../events';

/** Smoke-test function: proves app ⇄ Inngest ⇄ Postgres wiring by writing one audit row. */
export const ping = inngest.createFunction(
  { id: 'system-ping', triggers: [systemPing] },
  async ({ event, step }) => {
    const receivedAt = await step.run('write-audit', async () => {
      const at = new Date().toISOString();
      await writeAudit(getDb(), {
        organizationId: event.data.organizationId,
        actorType: 'system',
        action: 'system.ping',
        reason: 'Inngest wiring smoke test',
        input: event.data,
        output: { receivedAt: at },
        outcome: 'ok',
      });
      return at;
    });
    return { ok: true, receivedAt };
  },
);
