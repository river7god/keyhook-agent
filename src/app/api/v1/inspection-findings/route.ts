import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { createAgencyJob } from '@/domain/jobs';
import { inngest } from '@/workflows/client';
import { jobAdvanceRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  propertyId: z.uuid(),
  notes: z.string().trim().min(10).max(4000),
});

/** An inspection finding becomes a work order the agent triages (spec §12 R4). */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = body.parse(await request.json());
    const job = await withOrg(getDb(), user.organizationId, (tx) =>
      createAgencyJob(tx, {
        organizationId: user.organizationId,
        propertyId: input.propertyId,
        source: 'inspection',
        actor: { type: 'pm', id: user.propertyManagerId },
        title: 'Inspection finding',
        description: input.notes,
        reason: 'PM logged an inspection finding',
      }),
    );
    await inngest.send(
      jobAdvanceRequested.create({
        organizationId: user.organizationId,
        jobId: job.id,
        messageId: null,
      }),
    );
    return ok({ jobId: job.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
