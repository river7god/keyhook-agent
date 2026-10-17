import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { loadJobContext } from '@/agent/context';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { isDomainError } from '@/domain/errors';
import { getJob } from '@/domain/jobs';
import { getJobTimeline, type TimelineItem } from '@/domain/timeline';
import { formatNzd } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { PmActions } from './pm-actions';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const parsed = z.uuid().safeParse((await params).jobId);
  if (!parsed.success) notFound();
  const user = await requirePageUser();
  const data = await withOrg(getDb(), user.organizationId, async (tx) => {
    const job = await getJob(tx, user.organizationId, parsed.data).catch((err: unknown) => {
      if (isDomainError(err) && err.code === 'NOT_FOUND') return null;
      throw err;
    });
    if (!job) return null;
    const [ctx, timeline] = await Promise.all([
      loadJobContext(tx, job),
      getJobTimeline(tx, user.organizationId, job.id),
    ]);
    return { job, ctx, timeline };
  });
  if (!data) notFound();
  const { job, ctx, timeline } = data;
  const escalation =
    job.state === 'ESCALATED'
      ? [...timeline.items]
          .reverse()
          .find((i): i is Extract<TimelineItem, { kind: 'escalation' }> => i.kind === 'escalation')
      : undefined;

  return (
    <main className="page">
      <p className="sub">
        <Link href="/dashboard">← Jobs</Link>
      </p>
      <h1>{job.title}</h1>
      <p className="sub">
        <span className={`badge ${job.state}`}>{job.state.replaceAll('_', ' ')}</span>{' '}
        {job.urgency && <span className={`badge ${job.urgency}`}>{job.urgency}</span>}{' '}
        {ctx.property.address}, {ctx.property.suburb}
      </p>

      <div className="grid-2">
        <section>
          {escalation && (
            <div className="card escalation">
              <h2>Escalated: {escalation.reason}</h2>
              <p>{escalation.summary}</p>
              <p>
                <em>Done so far:</em> {escalation.whatHasBeenDone || '—'}
              </p>
              <p className="recommendation">Recommended: {escalation.recommendation}</p>
              {escalation.evidenceMessageIds.length > 0 && (
                <p>
                  Evidence:{' '}
                  {escalation.evidenceMessageIds.map((id, i) => (
                    <a key={id} href={`#${id}`} style={{ marginRight: 8 }}>
                      message {i + 1}
                    </a>
                  ))}
                </p>
              )}
            </div>
          )}

          <div className="card">
            <h2>Timeline</h2>
            <ol className="timeline">
              {timeline.items.map((item) => (
                <TimelineEntry key={item.id} item={item} />
              ))}
            </ol>
          </div>
        </section>

        <aside>
          <div className="card">
            <h2>Details</h2>
            <dl className="facts">
              <dt>Trade</dt>
              <dd>{job.trade ?? '—'}</dd>
              <dt>Confidence</dt>
              <dd>{job.triageConfidence === null ? '—' : job.triageConfidence.toFixed(2)}</dd>
              <dt>Tenant</dt>
              <dd>
                {ctx.tenant ? `${ctx.tenant.fullName} (${ctx.tenant.preferredLanguage})` : '—'}
              </dd>
              <dt>Tradie</dt>
              <dd>{ctx.tradie?.businessName ?? '—'}</dd>
              <dt>Estimate</dt>
              <dd>
                {job.estimateCents === null ? '—' : `${formatNzd(job.estimateCents)} incl GST`}
              </dd>
              <dt>Visit</dt>
              <dd>{job.scheduledStart ? formatNzDateTime(job.scheduledStart) : '—'}</dd>
              <dt>Source</dt>
              <dd>{job.source.replace('_', ' ')}</dd>
              <dt>Created</dt>
              <dd>{formatNzDateTime(job.createdAt)}</dd>
              <dt>AI cost</dt>
              <dd>
                US${(timeline.llmCostUsdMicros / 1e6).toFixed(4)} ({timeline.llmCalls} calls)
              </dd>
            </dl>
            {job.summary && <p style={{ marginBottom: 0 }}>{job.summary}</p>}
          </div>

          <PmActions
            jobId={job.id}
            state={job.state}
            stateBeforeEscalation={job.stateBeforeEscalation}
            urgency={job.urgency}
            trade={job.trade}
            hasTenant={Boolean(ctx.tenant)}
            hasTradie={Boolean(ctx.tradie)}
          />
        </aside>
      </div>
    </main>
  );
}

function TimelineEntry({ item }: { item: TimelineItem }) {
  const when = <div className="when">{formatNzDateTime(item.at)}</div>;
  switch (item.kind) {
    case 'message':
      return (
        <li id={item.id} className={item.direction}>
          {when}
          <strong>
            {item.from} → {item.to}
          </strong>
          {item.status === 'failed' && <span className="error"> (delivery failed)</span>}
          <div className="body">{item.body}</div>
        </li>
      );
    case 'transition':
      return (
        <li className="transition">
          {when}
          {item.from} → <strong>{item.to}</strong> · {item.actor}
          {item.reason && ` — ${item.reason}`}
        </li>
      );
    case 'escalation':
      return (
        <li className="escalation">
          {when}
          <strong>Escalation package:</strong> {item.reason}. Recommended: {item.recommendation}
        </li>
      );
    case 'triage':
      return (
        <li className="triage">
          {when}
          Triage: {item.urgency} / {item.trade} (confidence {item.confidence.toFixed(2)}) →{' '}
          {item.decision}
        </li>
      );
    case 'note':
      return (
        <li className="note">
          {when}
          Note ({item.actor}): {item.text}
        </li>
      );
    case 'approval':
      return (
        <li className="approval">
          {when}
          Approval {item.status}: {formatNzd(item.amountCents)}
          {item.decidedBy && ` by ${item.decidedBy}`} — {item.reason}
        </li>
      );
    case 'action':
      return (
        <li className="action">
          {when}
          <code>{item.action}</code> · {item.outcome} · {item.actor}
          {item.reason && ` — ${item.reason}`}
        </li>
      );
  }
}
