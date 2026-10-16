import { getDb } from '@/db/client';
import { listJobs } from '@/domain/jobs';
import { resolveDevOrganization } from '@/domain/organizations';
import { formatNzd } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** M0 placeholder: proves DB wiring. The real dashboard (queue, timeline, audit) is M3. */
export default async function DashboardPage() {
  const db = getDb();
  const org = await resolveDevOrganization(db);
  const jobs = await listJobs(db, org.id);

  return (
    <main>
      <h1>{org.name} — jobs</h1>
      {jobs.length === 0 ? (
        <p>No jobs yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Created (NZT)</th>
              <th>Property</th>
              <th>Title</th>
              <th>State</th>
              <th>Urgency</th>
              <th>Trade</th>
              <th>Estimate</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{formatNzDateTime(job.createdAt)}</td>
                <td>
                  {job.address}, {job.suburb}
                </td>
                <td>{job.title}</td>
                <td>{job.state}</td>
                <td>{job.urgency ?? '—'}</td>
                <td>{job.trade ?? '—'}</td>
                <td>{job.estimateCents === null ? '—' : formatNzd(job.estimateCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
