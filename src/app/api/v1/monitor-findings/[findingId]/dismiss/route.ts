import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { dismissFinding } from '@/domain/portfolio-monitor';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({ note: z.string().trim().max(500).nullable() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ findingId: string }> },
) {
  try {
    const user = await requireApiUser();
    const findingId = z.uuid().parse((await params).findingId);
    const input = body.parse(await request.json());
    await withOrg(getDb(), user.organizationId, (tx) =>
      dismissFinding(tx, {
        organizationId: user.organizationId,
        findingId,
        propertyManagerId: user.propertyManagerId,
        note: input.note,
        now: new Date(),
      }),
    );
    return ok({ dismissed: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
