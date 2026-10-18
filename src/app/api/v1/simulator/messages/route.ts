import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { receiveMessage } from '@/domain/inbound';
import { assertSimulatorAllowance } from '@/domain/usage-limits';
import { inngest } from '@/workflows/client';
import {
  arrearsAdvanceRequested,
  inboundRouteRequested,
  jobAdvanceRequested,
} from '@/workflows/events';
import { ok, toErrorResponse } from '../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z
  .strictObject({
    senderType: z.enum(['tenant', 'tradie']),
    senderId: z.uuid(),
    jobId: z.uuid().nullable(),
    arrearsCaseId: z.uuid().nullable().default(null),
    body: z.string().trim().max(2000),
    /** Photos as base64 (the simulator downsizes them in the browser first). */
    images: z.array(z.base64().max(6_000_000)).max(5).default([]),
  })
  .refine((v) => v.body.length > 0 || v.images.length > 0, {
    message: 'Send text or at least one photo',
  });

/**
 * Simulated inbound SMS/email from a tenant or tradie of the signed-in PM's organization.
 * Rate- and budget-limited: each message triggers model calls.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = body.parse(await request.json());
    const org = user.organizationId;
    const result = await withOrg(getDb(), org, async (tx) => {
      await assertSimulatorAllowance(tx, org, new Date());
      return receiveMessage(tx, {
        organizationId: org,
        senderType: input.senderType,
        senderId: input.senderId,
        jobId: input.jobId,
        arrearsCaseId: input.arrearsCaseId,
        body: input.body,
        images: input.images.map((b64) => Buffer.from(b64, 'base64')),
      });
    });
    await inngest.send(
      result.kind === 'job'
        ? jobAdvanceRequested.create({
            organizationId: org,
            jobId: result.jobId,
            messageId: result.messageId,
          })
        : result.kind === 'arrears'
          ? arrearsAdvanceRequested.create({
              organizationId: org,
              caseId: result.arrearsCaseId,
              messageId: result.messageId,
            })
          : inboundRouteRequested.create({ organizationId: org, messageId: result.messageId }),
    );
    return ok(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
