import { HandCoins } from 'lucide-react';
import Link from 'next/link';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { listArrearsCases } from '@/domain/arrears';
import { formatNzd } from '@/lib/money';
import { formatCalendarDate, formatNzDateTime } from '@/lib/time';
import { RecordPayment, RunCheck } from './arrears-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Arrears' };

const STATE_LABEL: Record<string, string> = {
  OPEN: 'opened',
  REMINDED: 'reminded',
  PROMISED: 'promise / plan',
  NOTICE_PENDING: 'notice awaiting you',
  NOTICE_SENT: 'notice sent',
  ESCALATED: 'needs you',
  RESOLVED: 'paid up',
  CLOSED: 'closed',
};
const STATE_BADGE: Record<string, string> = {
  NOTICE_PENDING: 'AWAITING_APPROVAL',
  ESCALATED: 'ESCALATED',
  RESOLVED: 'CLOSED',
  CLOSED: 'CANCELLED',
  PROMISED: 'SCHEDULED',
};

/** Arrears agent (spec §12 R8): reminders, promises and plans run themselves; notices need you. */
export default async function ArrearsPage() {
  const user = await requirePageUser();
  const cases = await withOrg(getDb(), user.organizationId, (tx) =>
    listArrearsCases(tx, user.organizationId),
  );
  const open = cases.filter((c) => c.state !== 'RESOLVED' && c.state !== 'CLOSED');
  const done = cases.filter((c) => c.state === 'RESOLVED' || c.state === 'CLOSED');
  const owed = open.reduce((n, c) => n + c.balanceCents, 0);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Arrears</h1>
          <p className="sub">
            The agent sends friendly reminders, agrees short promises and payment plans within
            policy, and follows up. Formal notices, hardship and Tribunal decisions come to you.
          </p>
        </div>
        <RunCheck />
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">
            <HandCoins size={15} /> Open cases
          </div>
          <div className="value">{open.length}</div>
          <div className="hint">{formatNzd(owed)} overdue in total</div>
        </div>
        <div className="stat">
          <div className="label">Need you</div>
          <div className="value">
            {open.filter((c) => c.state === 'ESCALATED' || c.state === 'NOTICE_PENDING').length}
          </div>
          <div className="hint">escalations and notices to approve</div>
        </div>
        <div className="stat">
          <div className="label">Promises & plans</div>
          <div className="value">{open.filter((c) => c.state === 'PROMISED').length}</div>
          <div className="hint">being tracked by the agent</div>
        </div>
      </div>

      {open.length === 0 && (
        <div className="card">No open arrears. Run a check to evaluate the ledger now.</div>
      )}
      {open.map((c) => (
        <div key={c.id} className="card">
          <div className="row" style={{ marginBottom: 6 }}>
            <Link href={`/dashboard/arrears/${c.id}`}>
              <strong style={{ color: 'var(--text)' }}>{c.tenantName}</strong>
            </Link>
            <span className={`badge ${STATE_BADGE[c.state] ?? ''}`}>
              {STATE_LABEL[c.state] ?? c.state}
            </span>
            <span className="sub" style={{ margin: 0 }}>
              {c.address}, {c.suburb}
            </span>
            <span style={{ flex: 1 }} />
            <strong style={{ color: 'var(--text)', fontSize: '1.1rem' }}>
              {formatNzd(c.balanceCents)}
            </strong>
          </div>
          <div className="sub" style={{ marginBottom: 8 }}>
            Oldest unpaid rent due {formatCalendarDate(c.oldestUnpaidDate)}
            {c.promiseDate && c.promiseAmountCents
              ? ` · ${c.planFrequency ? `${c.planFrequency} plan` : 'promise'}: ${formatNzd(c.promiseAmountCents)} by ${formatCalendarDate(c.promiseDate)}`
              : ''}
            {' · '}updated {formatNzDateTime(c.updatedAt)}
          </div>
          {c.state === 'ESCALATED' && c.escalationReason && (
            <p className="error" style={{ margin: '0 0 8px' }}>
              Why: {c.escalationReason}
            </p>
          )}
          {c.state === 'NOTICE_PENDING' && (
            <p style={{ margin: '0 0 8px' }}>
              <Link href="/dashboard/approvals">Review the 14-day notice →</Link>
            </p>
          )}
          <RecordPayment caseId={c.id} suggestedCents={c.balanceCents} />
        </div>
      ))}

      {done.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.05rem', margin: '28px 0 10px' }}>Resolved</h2>
          {done.map((c) => (
            <Link key={c.id} href={`/dashboard/arrears/${c.id}`} className="card job-row">
              <div>
                <strong>{c.tenantName}</strong>{' '}
                <span className={`badge ${STATE_BADGE[c.state] ?? ''}`}>
                  {STATE_LABEL[c.state]}
                </span>
                <div className="meta">
                  {c.address}, {c.suburb}
                </div>
              </div>
              <div className="meta">{formatNzDateTime(c.updatedAt)}</div>
            </Link>
          ))}
        </>
      )}
    </main>
  );
}
