import { z } from 'zod';
import { handBackJob } from '@/agent/pm-actions';
import { getDb } from '@/db/client';
import { tradeEnum, urgencyEnum } from '@/db/schema';
import { resolveDevOrganization } from '@/domain/organizations';
import { inngest } from '@/workflows/client';
import { jobAdvanceRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  propertyManagerId: z.uuid(),
  note: z.string().trim().max(500).nullable(),
  urgency: z.enum(urgencyEnum.enumValues).nullable(),
  trade: z.enum(tradeEnum.enumValues).nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const jobId = z.uuid().parse((await params).jobId);
    const input = body.parse(await request.json());
    const db = getDb();
    const org = await resolveDevOrganization(db);
    const result = await handBackJob(db, {
      organizationId: org.id,
      jobId,
      ...input,
      now: new Date(),
    });
    await inngest.send(
      jobAdvanceRequested.create({ organizationId: org.id, jobId, messageId: null }),
    );
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
