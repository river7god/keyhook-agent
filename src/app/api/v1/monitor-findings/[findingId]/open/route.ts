import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { openFinding } from '@/domain/portfolio-monitor';
import { inngest } from '@/workflows/client';
import { jobAdvanceRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({ note: z.string().trim().max(500).nullable() });

/** PM turns a Portfolio Monitor finding into a job (spec §12 R7). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ findingId: string }> },
) {
  try {
    const user = await requireApiUser();
    const findingId = z.uuid().parse((await params).findingId);
    const input = body.parse(await request.json());
    const job = await withOrg(getDb(), user.organizationId, (tx) =>
      openFinding(tx, {
        organizationId: user.organizationId,
        findingId,
        propertyManagerId: user.propertyManagerId,
        note: input.note,
        now: new Date(),
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
