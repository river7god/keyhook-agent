import { listPendingApprovals } from '@/agent/pm-actions';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { ok, toErrorResponse } from '../_lib/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireApiUser();
    const approvals = await withOrg(getDb(), user.organizationId, (tx) =>
      listPendingApprovals(tx, user.organizationId),
    );
    return ok({ approvals });
  } catch (err) {
    return toErrorResponse(err);
  }
}
