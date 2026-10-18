import { Bot, CircleAlert, CircleCheck, ClipboardCheck, MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { urgencyEnum } from '@/db/schema';
import { listDashboardJobs, stateCounts, type Bucket } from '@/domain/dashboard';
import { formatNzd } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Work orders' };

const query = z.object({
  bucket: z.enum(['needs_pm', 'active', 'done']).catch('needs_pm'),
  urgency: z.enum(urgencyEnum.enumValues).optional().catch(undefined),
});

const TABS: { bucket: Bucket; label: string }[] = [
  { bucket: 'needs_pm', label: 'Needs you' },
  { bucket: 'active', label: 'Agent working' },
  { bucket: 'done', label: 'Done' },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = query.parse(await searchParams);
  const user = await requirePageUser();
  const [counts, jobs] = await withOrg(getDb(), user.organizationId, (tx) =>
    Promise.all([
      stateCounts(tx, user.organizationId),
      listDashboardJobs(tx, user.organizationId, { bucket: q.bucket, urgency: q.urgency ?? null }),
    ]),
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Work orders</h1>
          <p className="sub">
            {user.organizationName} · the agent runs the job; you see what needs a person.
          </p>
        </div>
        <Link href="/dashboard/portfolio" className="button secondary">
          <ClipboardCheck size={16} /> Log inspection finding
        </Link>
        <Link href="/simulator" className="button">
          <MessageSquareText size={16} /> Open simulator
        </Link>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">
            <CircleAlert size={15} /> Needs you
          </div>
          <div className="value">{counts.needs_pm}</div>
          <div className="hint">
            {counts.byState.ESCALATED ?? 0} escalated · {counts.byState.AWAITING_APPROVAL ?? 0}{' '}
            approvals
          </div>
        </div>
        <div className="stat">
          <div className="label">
            <Bot size={15} /> Agent working
          </div>
          <div className="value">{counts.active}</div>
          <div className="hint">quoting, scheduling, chasing</div>
        </div>
        <div className="stat">
          <div className="label">
            <CircleCheck size={15} /> Done
          </div>
          <div className="value">{counts.done}</div>
          <div className="hint">closed or cancelled</div>
        </div>
      </div>

      <div className="tabs" role="navigation" aria-label="Job buckets">
        {TABS.map((t) => (
          <Link
            key={t.bucket}
            className="tab"
            href={`/dashboard?bucket=${t.bucket}`}
            aria-current={q.bucket === t.bucket ? 'page' : undefined}
          >
            {t.label}
            <span className="count">{counts[t.bucket]}</span>
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        {(['emergency', 'urgent', 'routine'] as const).map((u) => (
          <Link
            key={u}
            className="tab"
            href={
              q.urgency === u
                ? `/dashboard?bucket=${q.bucket}`
                : `/dashboard?bucket=${q.bucket}&urgency=${u}`
            }
            aria-current={q.urgency === u ? 'page' : undefined}
          >
            {u}
          </Link>
        ))}
      </div>

      {jobs.length === 0 ? (
        <p className="card">
          {q.bucket === 'needs_pm' ? 'Nothing needs you right now.' : 'No jobs here.'}
        </p>
      ) : (
        jobs.map((j) => (
          <Link key={j.id} href={`/dashboard/jobs/${j.id}`} className="card job-row">
            <div>
              <div>
                <strong>{j.title}</strong>{' '}
                <span className={`badge ${j.state}`}>{j.state.replaceAll('_', ' ')}</span>{' '}
                {j.urgency && <span className={`badge ${j.urgency}`}>{j.urgency}</span>}
              </div>
              <div className="meta">
                {j.address}, {j.suburb}
                {j.trade && ` · ${j.trade}`}
                {j.tradie && ` · ${j.tradie}`}
                {j.estimateCents !== null && ` · ${formatNzd(j.estimateCents)}`}
              </div>
              {j.escalationReason && (
                <div style={{ marginTop: 6 }}>
                  <span className="error">Why: {j.escalationReason}</span>
                  {j.recommendation && <div className="recommendation">→ {j.recommendation}</div>}
                </div>
              )}
            </div>
            <div className="meta" style={{ textAlign: 'right' }}>
              <div>Updated {formatNzDateTime(j.updatedAt)}</div>
              {j.scheduledStart && <div>Visit {formatNzDateTime(j.scheduledStart)}</div>}
              {j.nextFollowUpAt && (
                <div>
                  Next nudge {formatNzDateTime(j.nextFollowUpAt)} (
                  {j.nextFollowUpKind?.replace('_', ' ')})
                </div>
              )}
            </div>
          </Link>
        ))
      )}
    </main>
  );
}
