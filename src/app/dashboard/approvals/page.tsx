import Link from 'next/link';
import { listPendingApprovals } from '@/agent/pm-actions';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { formatNzd } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { ApprovalActions } from './approval-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals' };

/** Spend the agent may not approve itself: above the PM's limit, within the owner's. */
export default async function ApprovalsPage() {
  const user = await requirePageUser();
  const pending = await withOrg(getDb(), user.organizationId, (tx) =>
    listPendingApprovals(tx, user.organizationId),
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="sub">
            Quotes and variations above your auto-approval limit. The owner has been notified.
          </p>
        </div>
      </div>
      {pending.length === 0 ? (
        <div className="card">No approvals waiting — the agent has everything it needs.</div>
      ) : (
        pending.map((a) => (
          <div key={a.id} className="card">
            <div className="row" style={{ marginBottom: 6 }}>
              {a.kind === 'variation' ? (
                <span className="badge AWAITING_APPROVAL">variation</span>
              ) : (
                <span className="badge SCHEDULED">quote</span>
              )}
              <strong style={{ color: 'var(--text)', fontSize: '1.15rem' }}>
                {formatNzd(a.amountCents)}
              </strong>
              {a.kind === 'variation' && a.previousAmountCents !== null && (
                <span className="sub" style={{ margin: 0 }}>
                  was {formatNzd(a.previousAmountCents)}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <Link href={`/dashboard/jobs/${a.jobId}`}>{a.jobTitle}</Link>
            </div>
            <div className="sub" style={{ marginBottom: 8 }}>
              {a.address}, {a.suburb} · {a.tradie ?? 'no supplier'} · requested{' '}
              {formatNzDateTime(a.createdAt)}
            </div>
            <p style={{ margin: '0 0 12px', color: 'var(--gray-700)' }}>{a.reason}</p>
            <ApprovalActions approvalId={a.id} />
          </div>
        ))
      )}
    </main>
  );
}
