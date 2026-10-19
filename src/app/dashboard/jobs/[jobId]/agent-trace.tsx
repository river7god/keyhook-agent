import type { getJobTrace } from '@/domain/agent-trace';
import { formatNzDate, formatNzTime } from '@/lib/time';

type Trace = Awaited<ReturnType<typeof getJobTrace>>;

const usd = (micros: number) => `US$${(micros / 1e6).toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const NOWRAP = { whiteSpace: 'nowrap' } as const;
const NUM = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
} as const;
const n = (x: number) => x.toLocaleString('en-NZ');

/** Every model and tool call the agent made on this job: the "full trail" view of llm_calls + audit_log. */
export function AgentTrace({ trace }: { trace: Trace }) {
  const { rows, totals, bySteps } = trace;
  if (rows.length === 0) return null;
  const cacheShare =
    totals.inputTokens > 0 ? Math.round((totals.cachedTokens / totals.inputTokens) * 100) : 0;
  return (
    <div className="card">
      <h2>Agent trace</h2>
      <p className="sub" style={{ marginTop: -4 }}>
        Every model and tool call on this job, from <code>llm_calls</code> and the audit log
        {rows[0] ? ` · ${formatNzDate(rows[0].at)}` : ''}
      </p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        <span className="chip">
          {n(totals.modelCalls)} model calls
          {totals.failedModelCalls > 0 && ` · ${n(totals.failedModelCalls)} failed`}
        </span>
        <span className="chip">{n(totals.toolCalls)} tool calls</span>
        {totals.ruleDecisions > 0 && (
          <span className="chip">{n(totals.ruleDecisions)} decided by rules (no model)</span>
        )}
        <span className="chip">
          {n(totals.inputTokens)} in / {n(totals.outputTokens)} out tokens
        </span>
        <span className="chip">{cacheShare}% input from cache</span>
        <span className="chip">{secs(totals.modelLatencyMs)} model time</span>
        <span className="chip">
          {totals.unpricedCalls === totals.modelCalls
            ? 'cost not priced for this model'
            : `${usd(totals.costUsdMicros)}${totals.unpricedCalls > 0 ? ` + ${n(totals.unpricedCalls)} unpriced` : ''}`}
        </span>
      </div>
      {bySteps.length > 1 && (
        <p className="sub" style={{ marginTop: 0 }}>
          Slowest steps:{' '}
          {bySteps
            .slice(0, 3)
            .map((s) => `${s.step} ${secs(s.latencyMs)} (${n(s.calls)}×)`)
            .join(' · ')}
        </p>
      )}
      <div className="table-wrap" style={{ boxShadow: 'none' }}>
        <table className="audit">
          <thead>
            <tr>
              <th>When</th>
              <th>Call</th>
              <th>Model / outcome</th>
              <th style={{ textAlign: 'right' }}>Tokens in · out · cached</th>
              <th style={{ textAlign: 'right' }}>Latency</th>
              <th style={{ textAlign: 'right' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) =>
              r.kind === 'model' ? (
                <tr key={i}>
                  <td className="sub" style={NOWRAP}>
                    {formatNzTime(r.at)}
                  </td>
                  <td>
                    <span className="chip">model</span> {r.step}
                  </td>
                  <td style={NOWRAP}>
                    {r.model}
                    {r.outcome === 'error' ? (
                      <div className="error">{r.note}</div>
                    ) : (
                      r.note && <div className="sub">{r.note}</div>
                    )}
                  </td>
                  <td style={NUM}>
                    {n(r.inputTokens)} · {n(r.outputTokens)} · {n(r.cachedTokens)}
                  </td>
                  <td style={NUM}>{secs(r.latencyMs)}</td>
                  <td style={NUM}>{r.costUsdMicros === null ? '—' : usd(r.costUsdMicros)}</td>
                </tr>
              ) : (
                <tr key={i}>
                  <td className="sub" style={NOWRAP}>
                    {formatNzTime(r.at)}
                  </td>
                  <td>
                    <span className="chip">{r.kind}</span> {r.name}
                  </td>
                  <td colSpan={4}>
                    <span className={r.outcome === 'ok' ? '' : 'error'}>{r.outcome}</span>
                    {r.reason && <span className="sub"> — {r.reason}</span>}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
