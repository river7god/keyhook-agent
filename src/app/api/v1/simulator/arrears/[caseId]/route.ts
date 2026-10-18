import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { auditLog, messages } from '@/db/schema';
import { getCase } from '@/domain/arrears';
import { formatNzd } from '@/lib/money';
import { ok, toErrorResponse } from '../../../_lib/respond';

export const dynamic = 'force-dynamic';

/** Arrears conversation in the simulator's snapshot shape (thread key "arrears:<id>"). */
export async function GET(_r: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const user = await requireApiUser();
    const caseId = z.uuid().parse((await params).caseId);
    const org = user.organizationId;
    const snapshot = await withOrg(getDb(), org, async (tx) => {
      const c = await getCase(tx, org, caseId);
      const [conversation, audit] = await Promise.all([
        tx
          .select()
          .from(messages)
          .where(and(eq(messages.organizationId, org), eq(messages.arrearsCaseId, caseId)))
          .orderBy(asc(messages.createdAt)),
        tx
          .select({
            id: auditLog.id,
            action: auditLog.action,
            reason: auditLog.reason,
            outcome: auditLog.outcome,
            createdAt: auditLog.createdAt,
          })
          .from(auditLog)
          .where(and(eq(auditLog.organizationId, org), eq(auditLog.arrearsCaseId, caseId)))
          .orderBy(desc(auditLog.id))
          .limit(40),
      ]);
      const lastIn = conversation.filter((m) => m.direction === 'inbound').at(-1);
      const lastOut = conversation.filter((m) => m.direction === 'outbound').at(-1);
      const working =
        !!lastIn &&
        (!lastOut || lastOut.createdAt < lastIn.createdAt) &&
        Date.now() - lastIn.createdAt.getTime() < 5 * 60_000 &&
        c.state !== 'ESCALATED';
      return {
        job: {
          id: `arrears:${c.id}`,
          title: `Rent arrears — ${formatNzd(c.balanceCents)} overdue`,
          state: c.state,
          urgency: null,
          trade: null,
          estimateCents: null,
          scheduledStart: null,
        },
        messages: conversation,
        audit,
        activity: {
          working,
          waitingSince: working ? lastIn.createdAt.toISOString() : null,
          lastStep: null,
          stalled: false,
        },
        media: [],
        llmCostUsdMicros: 0,
      };
    });
    return ok(snapshot);
  } catch (err) {
    return toErrorResponse(err);
  }
}
