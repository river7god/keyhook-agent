import { z } from 'zod';
import { cancelJob } from '@/agent/pm-actions';
import { getDb } from '@/db/client';
import { resolveDevOrganization } from '@/domain/organizations';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  propertyManagerId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const jobId = z.uuid().parse((await params).jobId);
    const input = body.parse(await request.json());
    const db = getDb();
    const org = await resolveDevOrganization(db);
    return ok(await cancelJob(db, { organizationId: org.id, jobId, ...input }));
  } catch (err) {
    return toErrorResponse(err);
  }
}
