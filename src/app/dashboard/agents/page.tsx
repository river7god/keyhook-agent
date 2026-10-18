import Link from 'next/link';
import { AGENTS, STATUS_LABEL, type AgentInfo } from '@/app/_lib/agent-catalog';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { agentStats, type AgentStats } from '@/domain/agent-stats';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Agent catalog' };

function liveNumbers(id: string, s: AgentStats): [string, number][] | null {
  switch (id) {
    case 'maintenance':
      return [
        ['open', s.maintenance.open],
        ['closed', s.maintenance.closed],
        ['escalated', s.maintenance.escalated],
      ];
    case 'vision':
      return [['photos read', s.vision.analysed]];
    case 'variations':
      return [
        ['variations', s.variations.variations],
        ['invoices matched', s.variations.matched],
        ['to review', s.variations.review],
      ];
    case 'inspections':
      return [['work orders', s.inspections.created]];
    case 'monitor':
      return [
        ['open findings', s.monitor.open],
        ['opened as jobs', s.monitor.opened],
      ];
    case 'updates':
      return [['updates sent', s.updates.sent]];
    default:
      return null;
  }
}

function Card({ a, stats }: { a: AgentInfo; stats: AgentStats }) {
  const Icon = a.icon;
  const nums = a.status === 'live' ? liveNumbers(a.id, stats) : null;
  return (
    <article className={`agent-card${a.status === 'live' ? '' : ' dim'}`}>
      <header>
        <span className="icon-tile">
          <Icon size={22} />
        </span>
        <h3>{a.name}</h3>
        <span className={`pill ${a.status}`}>{STATUS_LABEL[a.status]}</span>
      </header>
      <div className="meta">
        <span className="chip">{a.trigger}</span>
        <span className="chip">{a.autonomy}</span>
      </div>
      <p>{a.summary}</p>
      {nums && (
        <div className="live-stat">
          {nums.map(([label, n]) => (
            <span key={label}>
              <b>{n}</b>
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="human">
        <strong>You decide:</strong> {a.humanDecides}
        {a.href && (
          <>
            {' · '}
            <Link href={a.href}>Open</Link>
          </>
        )}
      </div>
    </article>
  );
}

/** Every agent, what it may do on its own, and — for live ones — what it did this month. */
export default async function AgentsPage() {
  const user = await requirePageUser();
  const stats = await withOrg(getDb(), user.organizationId, (tx) =>
    agentStats(tx, user.organizationId, new Date()),
  );
  const live = AGENTS.filter((a) => a.status === 'live');
  const later = AGENTS.filter((a) => a.status !== 'live');
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Agent catalog</h1>
          <p className="sub">
            What each agent does on its own, and where it stops for you. Numbers cover the last{' '}
            {stats.days} days for {user.organizationName}.
          </p>
        </div>
      </div>
      <div className="agent-grid">
        {live.map((a) => (
          <Card key={a.id} a={a} stats={stats} />
        ))}
      </div>
      <h2 style={{ margin: '36px 0 14px', fontSize: '1.1rem' }}>Next and planned</h2>
      <div className="agent-grid">
        {later.map((a) => (
          <Card key={a.id} a={a} stats={stats} />
        ))}
      </div>
    </main>
  );
}
