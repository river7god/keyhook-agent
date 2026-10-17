import { asc, eq } from 'drizzle-orm';
import { listPendingApprovals } from '@/agent/pm-actions';
import { getDb } from '@/db/client';
import { propertyManagers } from '@/db/schema';
import { resolveDevOrganization } from '@/domain/organizations';
import { formatNzd } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { ApprovalActions } from './approval-actions';

export const dynamic = 'force-dynamic';

/** Minimal approvals queue (M2). The full PM dashboard arrives in M3. */
export default async function ApprovalsPage() {
  const db = getDb();
  const org = await resolveDevOrganization(db);
  const [pending, pms] = await Promise.all([
    listPendingApprovals(db, org.id),
    db
      .select({ id: propertyManagers.id, name: propertyManagers.fullName })
      .from(propertyManagers)
      .where(eq(propertyManagers.organizationId, org.id))
      .orderBy(asc(propertyManagers.fullName)),
  ]);

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '1rem',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <h1>Approvals</h1>
      {pending.length === 0 ? (
        <p>No approvals waiting.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {pending.map((a) => (
            <li
              key={a.id}
              style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}
            >
              <strong>{formatNzd(a.amountCents)}</strong> — {a.jobTitle}
              <div style={{ color: '#555' }}>
                {a.address}, {a.suburb} · {a.tradie ?? 'no tradie'} · requested{' '}
                {formatNzDateTime(a.createdAt)}
              </div>
              <p style={{ margin: '8px 0' }}>{a.reason}</p>
              <ApprovalActions approvalId={a.id} pms={pms} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
