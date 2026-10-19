import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { loadJobContext } from '@/agent/context';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { isDomainError } from '@/domain/errors';
import { getAgentActivity } from '@/domain/agent-activity';
import { getJobTrace } from '@/domain/agent-trace';
import { TOOL_NAMES } from '@/tools/registry';
import { listJobInvoices } from '@/domain/invoice-check';
import { getJob } from '@/domain/jobs';
import { listJobMedia } from '@/domain/media-store';
import { AgentActivityBadge } from '@/app/_lib/agent-activity-badge';
import { AutoRefresh } from '@/app/_lib/auto-refresh';
import { getJobTimeline, type TimelineItem } from '@/domain/timeline';
import { formatNzd } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { PmActions } from './pm-actions';
import { FeedbackForm } from './feedback-form';
import { AgentTrace } from './agent-trace';

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
    const [ctx, timeline, activity, photos, invoices, trace] = await Promise.all([
      loadJobContext(tx, job),
      getJobTimeline(tx, user.organizationId, job.id),
      getAgentActivity(tx, job, new Date()),
      listJobMedia(tx, user.organizationId, job.id),
      listJobInvoices(tx, user.organizationId, job.id),
      getJobTrace(tx, user.organizationId, job.id, TOOL_NAMES),
    ]);
    return { job, ctx, timeline, activity, photos, invoices, trace };
  });
  if (!data) notFound();
  const { job, ctx, timeline, activity, photos, invoices, trace } = data;
  const escalation =
    job.state === 'ESCALATED'
      ? [...timeline.items]
          .reverse()
          .find((i): i is Extract<TimelineItem, { kind: 'escalation' }> => i.kind === 'escalation')
      : undefined;

  return (
    <main className="page">
      <p className="sub" style={{ marginBottom: 8 }}>
        <Link href="/dashboard">Work orders</Link> / {ctx.property.address}
      </p>
      <div className="page-head">
        <div>
          <h1>{job.title}</h1>
          <div className="row">
            <span className={`badge ${job.state}`}>{job.state.replaceAll('_', ' ')}</span>
            {job.urgency && <span className={`badge ${job.urgency}`}>{job.urgency}</span>}
            {job.source !== 'tenant_message' && (
              <span className="chip">{job.source.replace('_', ' ')}</span>
            )}
            <span className="sub" style={{ margin: 0 }}>
              {ctx.property.address}, {ctx.property.suburb}
            </span>
          </div>
        </div>
      </div>

      <AutoRefresh active={activity.working} />
      {activity.working && (
        <p>
          <AgentActivityBadge activity={activity} />
        </p>
      )}
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
            {timeline.items.length === 0 && (
              <p className="sub" style={{ margin: 0 }}>
                No activity recorded — this job predates the agent.
              </p>
            )}
            <ol className="timeline">
              {timeline.items.map((item) => (
                <TimelineEntry key={item.id} item={item} photos={photos} />
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
              <dt>Supplier</dt>
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
                {timeline.llmCalls === 0
                  ? '—'
                  : timeline.llmCostUsdMicros > 0
                    ? `US$${(timeline.llmCostUsdMicros / 1e6).toFixed(4)} (${String(timeline.llmCalls)} calls)`
                    : `${String(timeline.llmCalls)} model calls (no price configured)`}{' '}
                {timeline.llmCalls > 0 && <a href="#agent-trace">View trace ↓</a>}
              </dd>
            </dl>
            {job.summary && <p style={{ marginBottom: 0 }}>{job.summary}</p>}
          </div>

          {invoices.length > 0 && (
            <div className="card">
              <h2>Invoices</h2>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {invoices.map((inv) => (
                  <li key={inv.id}>
                    <strong>{formatNzd(inv.amountCents)}</strong>
                    {inv.reference ? ` · ${inv.reference}` : ''} ·{' '}
                    <span className={`badge ${inv.status === 'matched' ? 'CLOSED' : 'ESCALATED'}`}>
                      {inv.status.replace('_', ' ')}
                    </span>
                    {inv.status === 'needs_review' && <div className="sub">{inv.reason}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <PmActions
            jobId={job.id}
            state={job.state}
            stateBeforeEscalation={job.stateBeforeEscalation}
            urgency={job.urgency}
            trade={job.trade}
            hasTenant={Boolean(ctx.tenant)}
            hasTradie={Boolean(ctx.tradie)}
          />
          <div className="card">
            <h2>Agent quality</h2>
            <FeedbackForm jobId={job.id} />
          </div>
        </aside>
      </div>

      <AgentTrace trace={trace} />
    </main>
  );
}

type Photo = Awaited<ReturnType<typeof listJobMedia>>[number];

function PhotoFigure({ p }: { p: Photo }) {
  const a = p.analysis;
  return (
    <figure style={{ margin: '8px 0 0' }}>
      <a href={`/api/v1/media/${p.id}`} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
        <img
          src={`/api/v1/media/${p.id}`}
          alt="Attached photo"
          style={{ maxWidth: 240, borderRadius: 10 }}
        />
      </a>
      <figcaption className="sub" style={{ margin: 0 }}>
        {!a
          ? 'Not analysed yet'
          : 'unavailable' in a
            ? 'Kept, not analysed (no vision model)'
            : `${a.quality}${a.showsIssue ? '' : ' · does not show the issue'} — ${a.observations}${
                a.label && (a.label.make ?? a.label.model)
                  ? ` · label: ${[a.label.make, a.label.model, a.label.serial].filter(Boolean).join(' ')}`
                  : ''
              }${a.safetyCues.length ? ` · ⚠ ${a.safetyCues.join(', ')}` : ''}`}
      </figcaption>
    </figure>
  );
}

function TimelineEntry({ item, photos }: { item: TimelineItem; photos: Photo[] }) {
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
          {photos
            .filter((p) => p.messageId === item.id)
            .map((p) => (
              <PhotoFigure key={p.id} p={p} />
            ))}
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
