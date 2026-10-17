import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { listPersonas } from '@/domain/personas';
import { Simulator } from './simulator';

export const dynamic = 'force-dynamic';

export default async function SimulatorPage() {
  const user = await requirePageUser();
  const personas = await withOrg(getDb(), user.organizationId, (tx) =>
    listPersonas(tx, user.organizationId),
  );
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '1rem',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Message simulator</h1>
      <p style={{ marginTop: 0, color: '#555' }}>
        Act as a tenant or tradie of {user.organizationName}. Messages go through the same path real
        SMS/email would. No real messages are sent (mock outbox).
      </p>
      <Simulator personas={personas} />
    </main>
  );
}
