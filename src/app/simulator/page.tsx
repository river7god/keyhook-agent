import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { listPersonas } from '@/domain/personas';
import { Simulator } from './simulator';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Message simulator' };

export default async function SimulatorPage() {
  const user = await requirePageUser();
  const personas = await withOrg(getDb(), user.organizationId, (tx) =>
    listPersonas(tx, user.organizationId),
  );
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Message simulator</h1>
          <p className="sub">
            Act as a tenant or supplier of {user.organizationName}. Messages take the same path real
            SMS or email would; nothing leaves the mock outbox.
          </p>
        </div>
      </div>
      <Simulator personas={personas} />
    </main>
  );
}
