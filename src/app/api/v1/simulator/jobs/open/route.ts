import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { findOpenCase } from '@/domain/arrears';
import { listOpenJobsForTenant, listOpenJobsForTradie } from '@/domain/jobs';
import { formatNzd } from '@/lib/money';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const query = z.object({ senderType: z.enum(['tenant', 'tradie']), senderId: z.uuid() });

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const org = user.organizationId;
    const jobs = await withOrg(getDb(), org, async (tx) => {
      if (q.senderType === 'tradie') return listOpenJobsForTradie(tx, org, q.senderId);
      const [open, arrears] = await Promise.all([
        listOpenJobsForTenant(tx, org, q.senderId),
        findOpenCase(tx, org, { tenantId: q.senderId }),
      ]);
      // Arrears conversations use a prefixed thread key in the simulator.
      return arrears
        ? [
            {
              id: `arrears:${arrears.id}`,
              title: `Rent arrears — ${formatNzd(arrears.balanceCents)} overdue`,
              state: arrears.state,
            },
            ...open,
          ]
        : open;
    });
    return ok({ jobs });
  } catch (err) {
    return toErrorResponse(err);
  }
}
