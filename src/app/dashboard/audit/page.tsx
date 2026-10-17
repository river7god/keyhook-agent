import Link from 'next/link';
import { z } from 'zod';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { actorTypeEnum } from '@/db/schema';
import { listAudit } from '@/domain/dashboard';
import { formatNzDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

const PAGE = 100;
const query = z.object({
  action: z.string().max(60).optional().catch(undefined),
  actor: z.enum(actorTypeEnum.enumValues).optional().catch(undefined),
  before: z.coerce.number().int().positive().optional().catch(undefined),
});

/** Organization-wide, append-only audit log (rule 4). */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = query.parse(await searchParams);
  const user = await requirePageUser();
  const rows = await withOrg(getDb(), user.organizationId, (tx) =>
    listAudit(tx, user.organizationId, {
      actionPrefix: q.action ?? null,
      actorType: q.actor ?? null,
      beforeId: q.before ?? null,
      limit: PAGE,
    }),
  );
  const qs = (extra: { before?: number }) => {
    const p = new URLSearchParams();
    if (q.action) p.set('action', q.action);
    if (q.actor) p.set('actor', q.actor);
    if (extra.before !== undefined) p.set('before', extra.before.toString());
    return `/dashboard/audit?${p.toString()}`;
  };

  return (
    <main className="page">
      <h1>Audit log</h1>
      <p className="sub">
        Every agent, PM and system action — who, what, why, inputs and outputs. Append-only.
      </p>

      <form className="tabs" action="/dashboard/audit">
        <input
          name="action"
          defaultValue={q.action ?? ''}
          placeholder="Action starts with… (e.g. job., send_)"
        />
        <select name="actor" defaultValue={q.actor ?? ''}>
          <option value="">any actor</option>
          {actorTypeEnum.enumValues.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <button>Filter</button>
      </form>

      <div className="table-wrap">
        <table className="audit">
          <thead>
            <tr>
              <th>When (NZT)</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Outcome</th>
              <th>Why</th>
              <th>Job</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatNzDateTime(r.createdAt)}</td>
                <td>
                  {r.actorType}
                  {r.actorId && (
                    <div className="sub" style={{ margin: 0 }}>
                      {r.actorId}
                    </div>
                  )}
                </td>
                <td>
                  <code>{r.action}</code>
                </td>
                <td>{r.outcome}</td>
                <td>{r.reason}</td>
                <td>
                  {r.jobId ? (
                    <Link href={`/dashboard/jobs/${r.jobId}`}>{r.jobTitle ?? 'job'}</Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <details>
                    <summary>json</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', maxWidth: 420 }}>
                      {JSON.stringify({ input: r.input, output: r.output }, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === PAGE && (
        <p>
          <Link href={qs({ before: rows.at(-1)?.id })}>Older →</Link>
        </p>
      )}
    </main>
  );
}
