import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { listOpenJobsForTenant, listOpenJobsForTradie } from '@/domain/jobs';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const query = z.object({ senderType: z.enum(['tenant', 'tradie']), senderId: z.uuid() });

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const org = user.organizationId;
    const jobs = await withOrg(getDb(), org, (tx) =>
      q.senderType === 'tenant'
        ? listOpenJobsForTenant(tx, org, q.senderId)
        : listOpenJobsForTradie(tx, org, q.senderId),
    );
    return ok({ jobs });
  } catch (err) {
    return toErrorResponse(err);
  }
}
