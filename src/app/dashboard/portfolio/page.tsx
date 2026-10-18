import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { listProperties } from '@/domain/properties';
import { InspectionForm } from './inspection-form';

export const dynamic = 'force-dynamic';

/** Agency-raised work: inspection findings (spec §12 R4). */
export default async function PortfolioPage() {
  const user = await requirePageUser();
  const props = await withOrg(getDb(), user.organizationId, (tx) =>
    listProperties(tx, user.organizationId),
  );

  return (
    <main className="page">
      <h1>Portfolio</h1>
      <div className="card">
        <h2>Log an inspection finding</h2>
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
