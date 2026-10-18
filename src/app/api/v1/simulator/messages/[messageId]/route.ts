import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { messages } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

/** Where an inbound message ended up (the inbox router places unrouted ones asynchronously). */
export async function GET(_r: Request, { params }: { params: Promise<{ messageId: string }> }) {
  try {
    const user = await requireApiUser();
    const id = z.uuid().parse((await params).messageId);
    const row = await withOrg(getDb(), user.organizationId, async (tx) => {
      const [m] = await tx
        .select({ jobId: messages.jobId, arrearsCaseId: messages.arrearsCaseId })
        .from(messages)
        .where(and(eq(messages.organizationId, user.organizationId), eq(messages.id, id)));
      return m;
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Message not found');
    return ok(row);
  } catch (err) {
    return toErrorResponse(err);
  }
}
