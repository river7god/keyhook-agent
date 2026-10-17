import { z } from 'zod';
import { pmSendMessage } from '@/agent/pm-actions';
import { getDb } from '@/db/client';
import { resolveDevOrganization } from '@/domain/organizations';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  propertyManagerId: z.uuid(),
  recipient: z.enum(['tenant', 'tradie']),
  body: z.string().trim().min(1).max(2000),
  /** Client-generated id so a double-submit sends once. */
  clientRequestId: z.uuid(),
});

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const jobId = z.uuid().parse((await params).jobId);
    const input = body.parse(await request.json());
    const db = getDb();
    const org = await resolveDevOrganization(db);
    return ok(await pmSendMessage(db, { organizationId: org.id, jobId, ...input }), {
      status: 201,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
