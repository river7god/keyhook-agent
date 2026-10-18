import { and, asc, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { auditLog, messages } from '@/db/schema';
import { getCase, loadCaseContext } from '@/domain/arrears';
import { isDomainError } from '@/domain/errors';
import { formatNzd } from '@/lib/money';
import { formatCalendarDate, formatNzDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Arrears case' };

export default async function ArrearsCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const parsed = z.uuid().safeParse((await params).caseId);
  if (!parsed.success) notFound();
  const user = await requirePageUser();
  const org = user.organizationId;
  const data = await withOrg(getDb(), org, async (tx) => {
    const c = await getCase(tx, org, parsed.data).catch((err: unknown) => {
      if (isDomainError(err) && err.code === 'NOT_FOUND') return null;
      throw err;
    });
    if (!c) return null;
    const [facts, convo, audit] = await Promise.all([
      loadCaseContext(tx, c),
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.organizationId, org), eq(messages.arrearsCaseId, c.id)))
        .orderBy(asc(messages.createdAt)),
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, org), eq(auditLog.arrearsCaseId, c.id)))
        .orderBy(desc(auditLog.id))
        .limit(50),
    ]);
    return { c, facts, convo, audit };
  });
  if (!data) notFound();
  const { c, facts, convo, audit } = data;

  return (
    <main className="page">
      <p className="sub" style={{ marginBottom: 8 }}>
        <Link href="/dashboard/arrears">Arrears</Link> / {facts.address}
      </p>
      <div className="page-head">
        <div>
          <h1>
            {facts.tenantName} · {formatNzd(c.balanceCents)} overdue
          </h1>
          <div className="row">
            <span className="badge">{c.state.replaceAll('_', ' ')}</span>
            <span className="sub" style={{ margin: 0 }}>
              {facts.address}, {facts.suburb} · oldest due {formatCalendarDate(c.oldestUnpaidDate)}
              {facts.rentCents
                ? ` · rent ${formatNzd(facts.rentCents)} ${facts.rentFrequency ?? ''}`
                : ''}
            </span>
          </div>
        </div>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Conversation</h2>
          <ol className="timeline">
            {convo.map((m) => (
              <li key={m.id} className={m.direction}>
                <div className="when">{formatNzDateTime(m.createdAt)}</div>
                <strong>
                  {m.direction === 'inbound' ? 'tenant → agent' : `agent → ${m.recipientType}`}
                </strong>
                <div className="body">{m.body}</div>
              </li>
            ))}
          </ol>
        </section>
        <aside className="card">
          <h2>Audit trail</h2>
          <ol className="timeline">
            {audit.map((a) => (
              <li key={a.id} className="action">
                <div className="when">{formatNzDateTime(a.createdAt)}</div>
                <code>{a.action}</code> · {a.actorType}
                {a.reason && ` — ${a.reason}`}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
  );
}
