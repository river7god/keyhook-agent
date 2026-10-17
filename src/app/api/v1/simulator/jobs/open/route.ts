import { z } from 'zod';
import { getDb } from '@/db/client';
import { listOpenJobsForTenant, listOpenJobsForTradie } from '@/domain/jobs';
import { resolveDevOrganization } from '@/domain/organizations';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const query = z.object({ senderType: z.enum(['tenant', 'tradie']), senderId: z.uuid() });

export async function GET(request: Request) {
  try {
    const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const db = getDb();
    const org = await resolveDevOrganization(db);
    const jobs =
      q.senderType === 'tenant'
        ? await listOpenJobsForTenant(db, org.id, q.senderId)
        : await listOpenJobsForTradie(db, org.id, q.senderId);
    return ok({ jobs });
  } catch (err) {
    return toErrorResponse(err);
  }
}
