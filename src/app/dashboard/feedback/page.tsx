import Link from 'next/link';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { listFeedback } from '@/domain/feedback';
import { formatNzDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

const show = (v: object) =>
  Object.entries(v as Record<string, unknown>)
    .filter(([k]) => k !== 'state')
    .map(([k, x]) => `${k}: ${String(x)}`)
    .join(', ') || '—';

/** Every correction a PM has made — the raw material for new eval scenarios. */
export default async function FeedbackPage() {
  const user = await requirePageUser();
  const rows = await withOrg(getDb(), user.organizationId, (tx) =>
    listFeedback(tx, user.organizationId, { limit: 200 }),
  );
  return (
    <main className="page">
      <h1>Agent corrections</h1>
      <p className="sub">
        PM corrections of the agent. Each becomes an eval scenario (<code>pnpm eval:harvest</code>)
        so the same mistake is caught before the next release.
      </p>
      <div className="table-wrap">
        <table className="audit">
          <thead>
            <tr>
              <th>When (NZT)</th>
              <th>Job</th>
              <th>What was wrong</th>
              <th>Agent decided</th>
              <th>Should have been</th>
              <th>By</th>
              <th>Harvested</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatNzDateTime(r.createdAt)}</td>
                <td>
                  <Link href={`/dashboard/jobs/${r.jobId}`}>{r.jobTitle}</Link>
                </td>
                <td>
                  {r.kind.replaceAll('_', ' ')}
                  {r.source === 'hand_back_override' && (
                    <div className="sub" style={{ margin: 0 }}>
                      from hand-back
                    </div>
                  )}
                  {r.note && (
                    <div className="sub" style={{ margin: 0 }}>
                      {r.note}
                    </div>
                  )}
                </td>
                <td>{show(r.agentSaw)}</td>
                <td>{show(r.expected)}</td>
                <td>{r.pm ?? '—'}</td>
                <td>{r.harvestedAt ? formatNzDateTime(r.harvestedAt) : 'not yet'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="card">No corrections yet.</p>}
    </main>
  );
}
