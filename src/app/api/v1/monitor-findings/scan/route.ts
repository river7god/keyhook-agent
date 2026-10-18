import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { scanRepeatedFaults } from '@/domain/portfolio-monitor';
import { ok, toErrorResponse } from '../../_lib/respond';

export const dynamic = 'force-dynamic';

/** Run the Portfolio Monitor now for the PM's organization (the daily cron does the same). */
export async function POST() {
  try {
    const user = await requireApiUser();
    const result = await withOrg(getDb(), user.organizationId, (tx) =>
      scanRepeatedFaults(tx, user.organizationId, new Date()),
    );
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
