import {
  ArrowRight,
  CircleCheck,
  Clock,
  Eye,
  Gauge,
  Lock,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Undo2,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { AGENTS, STATUS_LABEL, type AgentInfo } from '@/app/_lib/agent-catalog';
import { Brand } from '@/app/_lib/brand';
import { getCurrentUser } from '@/app/_lib/session';

export const dynamic = 'force-dynamic';

const REPO = 'https://github.com/river7god/keyhook-agent';

const LOOP = [
  ['Understand', 'Urgency, trade and confidence — photos included'],
  ['Gather', 'Property, tenancy and history; at most two questions'],
  ['Decide', 'Code applies escalation rules and spend limits'],
  ['Act', 'Brief a supplier, request a quote, book the visit'],
  ['Check', 'Every result validated; the state must move'],
  ['Escalate', 'Summary, what’s done, recommendation, evidence'],
  ['Keep going', 'Chase, reassign, verify the invoice, confirm, close'],
] as const;

const GUARDRAILS = [
  {
    icon: Workflow,
    title: 'State machine in charge',
    body: 'The model decides within a step. Code decides what happens next — never the prompt.',
  },
  {
    icon: Lock,
    title: 'Money needs authority',
    body: 'Spend above the PM or owner limit needs a stored approval, computed in integer cents.',
  },
  {
    icon: Undo2,
    title: 'Safe to retry',
    body: 'Every side effect is idempotent and serialised per job — no double messages, no double bookings.',
  },
  {
    icon: ShieldCheck,
    title: 'Injection-resistant',
    body: 'Tenant and supplier text (and text inside photos) is data. Instructions in it escalate.',
  },
  {
    icon: ScrollText,
    title: 'Immutable audit log',
    body: 'Who, what, why, inputs and outputs for every agent and PM action.',
  },
  {
    icon: Eye,
    title: 'Agency data stays separate',
    body: 'Row-level security on every table. Offshore AI providers need an explicit NZ Privacy Act opt-in.',
  },
] as const;

function AgentCard({ a }: { a: AgentInfo }) {
  const Icon = a.icon;
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
      <ul>
        {a.does.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <div className="human">
        <strong>A person decides:</strong> {a.humanDecides}
      </div>
    </article>
  );
}

export default async function HomePage() {
  const user = await getCurrentUser();
  const live = AGENTS.filter((a) => a.status === 'live');
  const later = AGENTS.filter((a) => a.status !== 'live');
  const primary = user
    ? { href: '/dashboard', label: 'Open dashboard' }
    : { href: '/login?next=/simulator', label: 'Try the live demo' };

  return (
    <>
      <header className="site-header">
        <div className="container">
          <nav aria-label="Site">
            <Brand />
            <div className="links">
              <a href="#agents">Agents</a>
              <a href="#how">How it works</a>
              <a href="#trust">Guardrails</a>
              <a href={REPO}>GitHub</a>
            </div>
            {user ? (
              <Link href="/dashboard" className="button">
                Dashboard
              </Link>
            ) : (
              <Link href="/login" className="button secondary">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container grid">
            <div>
              <span className="eyebrow">
                <Sparkles size={14} /> AI agents for NZ property managers
              </span>
              <h1>
                Maintenance that runs itself, <em>with you in charge.</em>
              </h1>
              <p className="lead">
                From the tenant’s first message to a closed, invoice-checked work order. The agent
                triages, briefs suppliers, chases, books and confirms — and hands you only what
                needs a person, with a recommendation ready.
              </p>
              <div className="cta-row">
                <Link href={primary.href} className="button lg">
                  {primary.label} <ArrowRight size={18} />
                </Link>
                <a href="#agents" className="button lg secondary">
                  Meet the agents
                </a>
              </div>
              <div className="trust">
                <span>
                  <CircleCheck size={16} /> 74 evaluated scenarios
                </span>
                <span>
                  <CircleCheck size={16} /> 0 forbidden actions
                </span>
                <span>
                  <CircleCheck size={16} /> Pacific/Auckland time, NZD
                </span>
              </div>
            </div>

            <div className="mock" aria-label="Example work order">
              <div className="bar">
                <i />
                <i />
                <i />
                <span style={{ marginLeft: 8 }}>Work order · 27 Rintoul Street, Newtown</span>
              </div>
              <div className="content">
                <div className="row" style={{ marginBottom: 10 }}>
                  <strong style={{ color: 'var(--text)', fontSize: '1.05rem', flex: 1 }}>
                    No hot water — gas cylinder
                  </strong>
                  <span className="badge urgent">urgent</span>
                  <span className="badge AWAITING_APPROVAL">awaiting approval</span>
                </div>
                {[
                  ['ok', 'Triaged', 'Urgent · plumbing · confidence 0.92', '7:02am'],
                  ['ok', 'Photo read', 'Rheem Stellar 360 · pilot light out', '7:02am'],
                  ['ok', 'Supplier briefed', 'Capital Plumbing — worked here before', '7:03am'],
                  ['ok', 'Tenant updated', 'In Samoan, the language Ana wrote in', '7:03am'],
                  ['ok', 'Quote received', '$690 incl GST · above your $500 limit', '9:41am'],
                  ['wait', 'Waiting for you', 'Approve or reject — owner notified', 'now'],
                ].map(([kind, title, detail, at]) => (
                  <div className="mock-step" key={title}>
                    <span className={`dot${kind === 'wait' ? ' wait' : ''}`}>
                      {kind === 'wait' ? <Clock size={14} /> : <CircleCheck size={14} />}
                    </span>
                    <span>
                      <b>{title}</b>
                      <br />
                      {detail}
                    </span>
                    <time>{at}</time>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section alt" id="agents">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">Agent catalog</span>
              <h2>One platform, a team of agents</h2>
              <p>
                Each agent is a thin workflow on shared foundations: permissioned tools, approvals,
                audit, evals. {live.length} are live today; the rest follow the tenancy lifecycle.
              </p>
            </div>
            <div className="agent-grid">
              {live.map((a) => (
                <AgentCard key={a.id} a={a} />
              ))}
            </div>
            <h3 style={{ textAlign: 'center', margin: '56px 0 20px' }}>On the roadmap</h3>
            <div className="agent-grid">
              {later.map((a) => (
                <AgentCard key={a.id} a={a} />
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">How it works</span>
              <h2>Four people, three systems, nine steps — handled</h2>
              <p>The same loop runs on every job, and keeps going until the job is closed.</p>
            </div>
            <ol className="steps" style={{ padding: 0, margin: 0 }}>
              {LOOP.map(([t, d]) => (
                <li key={t}>
                  <b>{t}</b>
                  <p>{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section dark" id="trust">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">Guardrails</span>
              <h2>Production software, not a chatbot</h2>
              <p>An agent that acts needs rules it can’t talk its way around.</p>
            </div>
            <div className="feature-grid">
              {GUARDRAILS.map((g) => {
                const Icon = g.icon;
                return (
                  <div className="feature" key={g.title}>
                    <Icon size={24} />
                    <h3>{g.title}</h3>
                    <p>{g.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="section alt">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">
                <Gauge size={14} /> Measured, not claimed
              </span>
              <h2>It checks its own work</h2>
              <p>
                Every change runs against a scenario suite. When a PM flags a mistake, it becomes a
                new scenario.
              </p>
            </div>
            <div className="numbers">
              <div className="number">
                <b>100%</b>
                <span>Urgency accuracy</span>
                <p>Claude Opus 5.5 smoke set and Kimi K2.6 full set</p>
              </div>
              <div className="number">
                <b>97%</b>
                <span>Escalation recall</span>
                <p>Hands over when a person is needed</p>
              </div>
              <div className="number">
                <b>0</b>
                <span>Forbidden actions</span>
                <p>Unapproved spend, unsafe messages</p>
              </div>
              <div className="number">
                <b>259</b>
                <span>Automated tests</span>
                <p>Incl. RLS, concurrency, injection</p>
              </div>
            </div>
            <div className="cta-row" style={{ justifyContent: 'center', marginTop: 40 }}>
              <Link href={primary.href} className="button lg">
                {primary.label} <ArrowRight size={18} />
              </Link>
              <a href={REPO} className="button lg secondary">
                Read the code
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="cols">
            <div style={{ maxWidth: 340 }}>
              <Brand />
              <p>
                AI agents that take property-management work from start to finish, and know when to
                hand it to a person.
              </p>
            </div>
            <div>
              <p>
                <b>Product</b>
              </p>
              <p>
                <a href="#agents">Agents</a>
                <br />
                <a href="#how">How it works</a>
                <br />
                <a href="#trust">Guardrails</a>
              </p>
            </div>
            <div>
              <p>
                <b>Project</b>
              </p>
              <p>
                <a href={REPO}>GitHub</a>
                <br />
                <a href={`${REPO}/blob/main/docs/architecture.md`}>Architecture</a>
                <br />
                <a href={`${REPO}/blob/main/docs/roadmap.md`}>Roadmap</a>
              </p>
            </div>
          </div>
          <div className="legal">
            Independent portfolio project built for an application to Keyhook. Not affiliated with
            or endorsed by Keyhook. All properties, tenants and suppliers shown are fictional.
          </div>
        </div>
      </footer>
    </>
  );
}
