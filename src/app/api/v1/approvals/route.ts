import { listPendingApprovals } from '@/agent/pm-actions';
import { getDb } from '@/db/client';
import { resolveDevOrganization } from '@/domain/organizations';
import { ok, toErrorResponse } from '../_lib/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const org = await resolveDevOrganization(db);
    return ok({ approvals: await listPendingApprovals(db, org.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
