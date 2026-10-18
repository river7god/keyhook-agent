import { ClipboardCheck, Radar } from 'lucide-react';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { listOpenFindings } from '@/domain/portfolio-monitor';
import { listProperties } from '@/domain/properties';
import { formatNzDateTime } from '@/lib/time';
import { FindingActions, ScanNow } from './finding-actions';
import { InspectionForm } from './inspection-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Portfolio' };

/** Agency-raised work: Portfolio Monitor findings (R7) and inspection findings (R4). */
export default async function PortfolioPage() {
  const user = await requirePageUser();
  const [props, findings] = await withOrg(getDb(), user.organizationId, (tx) =>
    Promise.all([
      listProperties(tx, user.organizationId),
      listOpenFindings(tx, user.organizationId),
    ]),
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Portfolio</h1>
          <p className="sub">Work the agency raises itself: monitor findings and inspections.</p>
        </div>
      </div>
      <div className="card">
        <h2>
          <Radar size={18} /> Portfolio Monitor <span className="spacer" /> <ScanNow />
        </h2>
        <p className="sub">
          Repeated faults: 3 or more jobs of the same trade at one property in 12 months. The
          monitor only suggests — you decide whether it becomes a job.
        </p>
        {findings.length === 0 ? (
          <p>No open findings.</p>
        ) : (
          <ul className="list">
            {findings.map((f) => (
              <li key={f.id}>
                <div className="row">
                  <strong style={{ color: 'var(--text)' }}>
                    {f.address}, {f.suburb}
                  </strong>
                  <span className="badge urgent">repeated {f.trade} fault</span>
                  <span className="sub" style={{ margin: 0 }}>
                    detected {formatNzDateTime(f.detectedAt)}
                  </span>
                </div>
                <p style={{ margin: '6px 0' }}>{f.summary}</p>
                <p className="recommendation" style={{ margin: '6px 0' }}>
                  {f.recommendation}
                </p>
                <FindingActions findingId={f.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <h2>
          <ClipboardCheck size={18} /> Log an inspection finding
        </h2>
        <p className="sub">
          The agent turns it into a work order: triage, quote, and — if the property is let — it
          tells the tenant and asks them for a visit time.
        </p>
        <InspectionForm
          properties={props.map((p) => ({
            id: p.id,
            label: `${p.address}, ${p.suburb}${p.let ? '' : ' (vacant)'}`,
          }))}
        />
      </div>
    </main>
  );
}
