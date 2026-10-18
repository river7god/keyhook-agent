import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { getCase, recordPayment } from '@/domain/arrears';
import { nzDate } from '@/lib/time';
import { inngest } from '@/workflows/client';
import { arrearsAdvanceRequested } from '@/workflows/events';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

const body = z.strictObject({
  amountCents: z.number().int().positive().max(10_000_000),
  reference: z.string().trim().max(200).nullable(),
});

/**
 * Record a rent payment against the case's tenancy (stands in for the bank-feed match Keyhook's
 * financials would provide), then let the agent re-evaluate the case.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const user = await requireApiUser();
    const caseId = z.uuid().parse((await params).caseId);
    const input = body.parse(await request.json());
    await withOrg(getDb(), user.organizationId, async (tx) => {
      const c = await getCase(tx, user.organizationId, caseId);
      await recordPayment(tx, {
        organizationId: user.organizationId,
        tenancyId: c.tenancyId,
        amountCents: input.amountCents,
        date: nzDate(new Date()),
        reference: input.reference,
        actor: { type: 'pm', id: user.propertyManagerId },
      });
    });
    await inngest.send(
      arrearsAdvanceRequested.create({
        organizationId: user.organizationId,
        caseId,
        messageId: null,
      }),
    );
    return ok({ recorded: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
