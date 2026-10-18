import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { listOpenCaseIds } from '@/domain/arrears';
import { inngest } from '@/workflows/client';
import { arrearsSweepRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../_lib/respond';

export const dynamic = 'force-dynamic';

/** Queue the arrears sweep for the PM's organization now (the daily cron does the same). */
export async function POST() {
  try {
    const user = await requireApiUser();
    const open = await withOrg(getDb(), user.organizationId, (tx) =>
      listOpenCaseIds(tx, user.organizationId),
    );
    await inngest.send(arrearsSweepRequested.create({ organizationId: user.organizationId }));
    return ok({ queued: true, openCases: open.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
