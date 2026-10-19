import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { latestAuditOutput } from '@/domain/audit';
import { inngest } from '@/workflows/client';
import { opsAnalysisRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../_lib/respond';

export const dynamic = 'force-dynamic';

async function lastAnalysisAt(organizationId: string): Promise<string | null> {
  const row = await withOrg(getDb(), organizationId, (tx) =>
    latestAuditOutput(tx, organizationId, 'ops.analysis'),
  );
  return row?.at.toISOString() ?? null;
}

/** When the latest Ops analyst brief was written (the page polls this after "Run analysis"). */
export async function GET() {
  try {
    const user = await requireApiUser();
    return ok({ lastAt: await lastAnalysisAt(user.organizationId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Queue the Ops analyst for the PM's organization now (the weekly cron does the same). */
export async function POST() {
  try {
    const user = await requireApiUser();
    const lastAt = await lastAnalysisAt(user.organizationId);
    await inngest.send(opsAnalysisRequested.create({ organizationId: user.organizationId }));
    return ok({ queued: true, lastAt });
  } catch (err) {
    return toErrorResponse(err);
  }
}
