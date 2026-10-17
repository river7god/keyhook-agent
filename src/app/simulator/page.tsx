import { getDb } from '@/db/client';
import { resolveDevOrganization } from '@/domain/organizations';
import { listPersonas } from '@/domain/personas';
import { Simulator } from './simulator';

export const dynamic = 'force-dynamic';

export default async function SimulatorPage() {
  const db = getDb();
  const org = await resolveDevOrganization(db);
  const personas = await listPersonas(db, org.id);
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
        Act as a tenant or tradie of {org.name}. Messages go through the same path real SMS/email
        would. No real messages are sent (mock outbox).
      </p>
      <Simulator personas={personas} />
    </main>
  );
}
