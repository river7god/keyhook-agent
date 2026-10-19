import { latestOpsAnalysis } from '@/agent/ops/analyst';
import { detectInsights, type Insight } from '@/agent/ops/insights';
import { requirePageUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { cacheShare, usageReport } from '@/domain/usage';
import { formatNzDateTime } from '@/lib/time';
import { RunAnalysis } from './run-analysis';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Usage & cost' };

const n = (x: number) => x.toLocaleString('en-NZ');
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (micros: number) => `US$${(micros / 1e6).toFixed(micros < 1e6 ? 4 : 2)}`;
const pct = (x: number) => `${String(Math.round(x * 100))} %`;
const NUM = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
} as const;
const KIND_BADGE: Record<Insight['kind'], string> = {
  risk: 'ESCALATED',
  saving: 'SCHEDULED',
  info: 'CANCELLED',
};

/**
 * Model usage for the organization (last 30 days): what each step costs and how fast it is, what
 * code detects as worth changing, and the Ops analyst's latest ranked brief.
 */
export default async function UsagePage() {
  const user = await requirePageUser();
  const { report, latest } = await withOrg(getDb(), user.organizationId, async (tx) => ({
    report: await usageReport(tx, user.organizationId, new Date()),
    latest: await latestOpsAnalysis(tx, user.organizationId),
  }));
  const insights = detectInsights(report);
  const t = report.totals;
  const ruleShare =
    report.rules.ruleDecisions + report.rules.modelCallsSameSteps > 0
      ? report.rules.ruleDecisions / (report.rules.ruleDecisions + report.rules.modelCallsSameSteps)
      : null;
  const brief = latest?.analysis.brief;
  const byId = new Map(insights.map((i) => [i.id, i]));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Usage & cost</h1>
          <p className="sub">
            Every model call in the last {report.days} days for {user.organizationName}, by step and
            model. Findings are computed from these numbers; the Ops analyst ranks them weekly.
          </p>
        </div>
        <RunAnalysis />
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Model calls</div>
          <div className="value">{n(t.calls)}</div>
          <div className="hint">
            {n(t.jobs)} jobs · {t.calls ? pct(t.errors / t.calls) : '—'} failed
          </div>
        </div>
        <div className="stat">
          <div className="label">Cost</div>
          <div className="value">
            {t.calls > t.errors && t.unpricedCalls === t.calls - t.errors
              ? 'Not priced'
              : usd(t.costUsdMicros)}
          </div>
          <div className="hint">
            {t.unpricedCalls
              ? `${n(t.unpricedCalls)} calls without a price (LLM_PRICES_JSON)`
              : 'all calls priced'}
          </div>
        </div>
        <div className="stat">
          <div className="label">Tokens</div>
          <div className="value">{n(t.inputTokens + t.cachedTokens + t.outputTokens)}</div>
          <div className="hint">{pct(cacheShare(t))} of input from prompt cache</div>
        </div>
        <div className="stat">
          <div className="label">Read by rules</div>
          <div className="value">{n(report.rules.ruleDecisions)}</div>
          <div className="hint">
            {ruleShare === null
              ? 'no slot or confirmation replies yet'
              : `${pct(ruleShare)} of slot and confirmation replies, no model call`}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Ops analyst</h2>
        {!latest ? (
          <p className="sub" style={{ margin: 0 }}>
            No brief yet. It runs every Monday at 07:00, or now with the button above.
          </p>
        ) : !brief ? (
          <p className="sub" style={{ margin: 0 }}>
            {formatNzDateTime(latest.at)}: nothing to recommend.
          </p>
        ) : (
          <>
            <p className="sub" style={{ marginTop: 0 }}>
              {formatNzDateTime(latest.at)} · ranks the findings below; it cannot add its own
            </p>
            <p style={{ fontWeight: 600 }}>{brief.headline}</p>
            <ol style={{ paddingLeft: 18, margin: 0 }}>
              {brief.priorities.map((p) => (
                <li key={p.insightId} style={{ marginBottom: 8 }}>
                  <strong>{byId.get(p.insightId)?.title ?? p.insightId}</strong> — {p.why}
                  <div className="sub" style={{ margin: 0 }}>
                    Next: {p.nextStep}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <div className="card">
        <h2>Findings</h2>
        {insights.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>
            Nothing stands out in the last {report.days} days.
          </p>
        ) : (
          <ul className="list">
            {insights.map((i) => (
              <li key={i.id}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className={`badge ${KIND_BADGE[i.kind]}`}>{i.kind}</span>
                  <strong>{i.title}</strong>
                  {i.savingUsdPer30Days !== null && (
                    <span className="chip">≈ US${i.savingUsdPer30Days.toFixed(2)} / 30 days</span>
                  )}
                  {i.needsEval && <span className="chip">eval first</span>}
                </div>
                <div className="sub" style={{ margin: '4px 0 0' }}>
                  {i.evidence}
                </div>
                <div style={{ marginTop: 2 }}>{i.action}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="table-wrap">
        <table className="audit">
          <thead>
            <tr>
              <th>Step</th>
              <th>Model</th>
              <th style={NUM}>Calls</th>
              <th style={NUM}>Failed</th>
              <th style={NUM}>p50 / p95</th>
              <th style={NUM}>Tokens in · out</th>
              <th style={NUM}>From cache</th>
              <th style={NUM}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {report.steps.map((s) => (
              <tr key={`${s.group}:${s.model}`}>
                <td>{s.group}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{s.model}</td>
                <td style={NUM}>{n(s.calls)}</td>
                <td style={NUM}>{s.errors ? n(s.errors) : '—'}</td>
                <td style={NUM}>
                  {secs(s.p50Ms)} / {secs(s.p95Ms)}
                </td>
                <td style={NUM}>
                  {n(s.inputTokens + s.cachedTokens)} · {n(s.outputTokens)}
                </td>
                <td style={NUM}>{pct(cacheShare(s))}</td>
                <td style={NUM}>
                  {s.unpricedCalls === s.calls - s.errors && s.calls > s.errors
                    ? 'not priced'
                    : usd(s.costUsdMicros)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
