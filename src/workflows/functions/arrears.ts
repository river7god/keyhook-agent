import { cron, type GetStepTools } from 'inngest';
import { advanceArrears } from '@/agent/arrears/advance';
import { routeInbound } from '@/agent/arrears/route';
import { openDueCases } from '@/agent/arrears/sweep';
import { llmForOrganization } from '@/agent/providers';
import { getDb } from '@/db/client';
import { organizations } from '@/db/schema';
import { inngest } from '../client';
import { perArrearsCaseConcurrency } from '../concurrency';
import {
  arrearsAdvanceRequested,
  arrearsSweepRequested,
  inboundRouteRequested,
  jobAdvanceRequested,
} from '../events';

const deps = async (organizationId: string) => {
  const db = getDb();
  return { db, llm: await llmForOrganization(db, organizationId), now: () => new Date() };
};

/** A tenant replied on an arrears case (or a PM decision needs follow-through). */
export const arrearsAdvance = inngest.createFunction(
  {
    id: 'arrears-advance',
    triggers: [arrearsAdvanceRequested],
    concurrency: perArrearsCaseConcurrency,
    retries: 3,
  },
  async ({ event, step }) =>
    step.run('advance', async () =>
      advanceArrears(await deps(event.data.organizationId), {
        organizationId: event.data.organizationId,
        caseId: event.data.caseId,
        messageId: event.data.messageId,
      }),
    ),
);

/**
 * Daily at 09:00 NZ (inside business hours): open due cases, then fan out one advance event per
 * case, so time rules and tenant replies for a case never run at the same time.
 */
export const arrearsSweep = inngest.createFunction(
  { id: 'arrears-sweep', triggers: [cron('TZ=Pacific/Auckland 0 9 * * *')] },
  async ({ step }) => {
    const orgIds = await step.run('list-organizations', async () =>
      (await getDb().select({ id: organizations.id }).from(organizations)).map((o) => o.id),
    );
    let cases = 0;
    for (const id of orgIds) cases += await sweepOrganization(step, id);
    return { organizations: orgIds.length, cases };
  },
);

type Step = GetStepTools<typeof inngest>;

async function sweepOrganization(step: Step, organizationId: string): Promise<number> {
  const { openCaseIds } = await step.run(`open-${organizationId}`, async () =>
    openDueCases(await deps(organizationId), organizationId),
  );
  if (openCaseIds.length) {
    await step.sendEvent(
      `advance-${organizationId}`,
      openCaseIds.map((caseId) =>
        arrearsAdvanceRequested.create({ organizationId, caseId, messageId: null }),
      ),
    );
  }
  return openCaseIds.length;
}

/** On demand for one organization (dashboard button). */
export const arrearsSweepNow = inngest.createFunction(
  {
    id: 'arrears-sweep-now',
    triggers: [arrearsSweepRequested],
    concurrency: { key: 'event.data.organizationId', limit: 1 },
  },
  async ({ event, step }) => ({ cases: await sweepOrganization(step, event.data.organizationId) }),
);

/** Inbox router: attach an unrouted tenant message to their arrears case or a new job. */
export const inboundRoute = inngest.createFunction(
  { id: 'inbound-route', triggers: [inboundRouteRequested], retries: 3 },
  async ({ event, step }) => {
    const routed = await step.run('route', async () =>
      routeInbound(await deps(event.data.organizationId), {
        organizationId: event.data.organizationId,
        messageId: event.data.messageId,
      }),
    );
    await step.sendEvent(
      'advance',
      routed.kind === 'arrears'
        ? arrearsAdvanceRequested.create({
            organizationId: event.data.organizationId,
            caseId: routed.caseId,
            messageId: event.data.messageId,
          })
        : jobAdvanceRequested.create({
            organizationId: event.data.organizationId,
            jobId: routed.jobId,
            messageId: event.data.messageId,
          }),
    );
    return routed;
  },
);
