/**
 * pnpm eval [filter] — run every scenario in evals/scenarios/ against the real model (spec §10).
 *
 * Each scenario runs on a fresh, seeded `keyhook_eval` database through the production path:
 * ingestMessage → advanceJob (ClaudeLlm, real tools, mock outbox), PM decisions via the same
 * services the dashboard uses, and simulated time for follow-ups. The resulting job is scored
 * against `expect`. Full runs are saved to evals/results/<git-sha>.json.
 *
 * Costs real money (roughly US$0.05–0.30 per scenario with Claude). Needs the chosen provider's
 * API key. Compare models with `pnpm eval --model openai:<model>` etc. before switching routing.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { advanceJob, type AgentDeps } from '@/agent/advance';
import { handleFollowUp } from '@/agent/handlers/follow-up';
import type { LlmClient } from '@/agent/llm';
import { DEFAULT_MODEL, RoutingLlm } from '@/agent/providers';
import { parseModelRef, PROVIDERS, type ModelRef } from '@/agent/providers/registry';
import { handBackJob, recordApprovalDecision } from '@/agent/pm-actions';
import { createDb, type Db } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import {
  approvals,
  auditLog,
  llmCalls,
  messages,
  properties,
  tradeEnum,
  urgencyEnum,
} from '@/db/schema';
import { currentTenancyFor, primaryTenantFor } from '@/db/seed/data/tenancies';
import { ORG, PROPERTY } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { listDueFollowUps } from '@/domain/follow-ups';
import { ingestMessage } from '@/domain/inbound';
import { getJob } from '@/domain/jobs';
import { flushTelemetry, registerTelemetry } from '@/lib/telemetry';
import { JOB_STATES } from '@/workflows/job-states';

const step = z.union([
  z.strictObject({ tenant: z.string().min(1) }),
  z.strictObject({ tradie: z.string().min(1) }),
  z.strictObject({ pm: z.enum(['approve', 'reject', 'hand_back']) }),
  /** Advance simulated time and run every follow-up that is then due. */
  z.strictObject({ wait: z.number().positive() }),
]);

export const scenarioSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  /** Harvested scenarios start unreviewed (may contain real text) and are skipped by default. */
  reviewed: z.boolean().default(true),
  /** Where the scenario came from, e.g. "agent_feedback:<id>". */
  source: z.string().optional(),
  property: z.enum(Object.keys(PROPERTY) as [keyof typeof PROPERTY, ...(keyof typeof PROPERTY)[]]),
  /** Shorthand for tenant-only steps. */
  messages: z.array(z.string()).optional(),
  steps: z.array(step).optional(),
  expect: z.object({
    urgency: z.array(z.enum(urgencyEnum.enumValues)).optional(),
    trade: z.array(z.enum(tradeEnum.enumValues)).optional(),
    escalate: z.boolean().optional(),
    state: z.array(z.enum(JOB_STATES)).optional(),
    estimateCents: z.number().int().optional(),
    /** Script of every agent → tenant message: latin (e.g. English, Samoan) or cjk (Chinese). */
    replyScript: z.enum(['latin', 'cjk']).optional(),
    /** Audit actions that must have succeeded at least once. */
    actions: z.array(z.string()).default([]),
    /** Audit actions that must never succeed. */
    forbidden: z.array(z.string()).default([]),
  }),
});
export type Scenario = z.infer<typeof scenarioSchema>;
type Step = z.infer<typeof step>;

type CheckName = 'urgency' | 'trade' | 'escalate' | 'state' | 'estimate' | 'actions' | 'language';
interface ScenarioResult {
  id: string;
  urgency: string | null;
  trade: string | null;
  state: string;
  escalated: boolean;
  expectedEscalate: boolean | null;
  checks: Partial<Record<CheckName, boolean>>;
  missingActions: string[];
  forbiddenHits: string[];
  llmCalls: number;
  /** Calls whose cost is unknown (no price configured for the model). */
  unpricedCalls: number;
  costUsdMicros: number;
  stoppedEarly?: string;
  /** Why the agent decided what it did — for reading failures without re-running. */
  diagnostics?: {
    escalationReason?: string;
    triage?: {
      confidence: number;
      needsMoreInfo: boolean;
      flags: string[];
      decision: string;
      reasons: string[];
    };
    lastAudit?: string[];
  };
  latencyMs: number;
  error?: string;
}

const here = path.dirname(new URL(import.meta.url).pathname);
const SEED_TIME = new Date('2026-10-19T00:00:00Z'); // Monday 1pm NZDT — business hours

async function main() {
  try {
    process.loadEnvFile(path.join(here, '..', '.env'));
  } catch {
    /* CI provides env */
  }
  // Usage: pnpm eval [filter] [--model provider:model] [--include-unreviewed]
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf('--model');
  const model: ModelRef = modelIdx >= 0 ? parseModelRef(args[modelIdx + 1] ?? '') : DEFAULT_MODEL;
  const filter = args.filter(
    (a, i) => !a.startsWith('--') && (modelIdx < 0 || i !== modelIdx + 1),
  )[0];
  const keyEnv = PROVIDERS[model.provider].apiKeyEnv;
  if (!process.env[keyEnv]) {
    console.error(`pnpm eval: ${keyEnv} is not set (add it to .env). Evals call the real model.`);
    process.exit(2);
  }
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is not set');
  registerTelemetry();
  const evalUrl = await ensureEvalDatabase(baseUrl);

  const includeUnreviewed = args.includes('--include-unreviewed');
  const scenarios = loadScenarios().filter(
    (s) =>
      (!filter || filter.split(',').some((f) => s.id.includes(f.trim()))) &&
      (s.reviewed || includeUnreviewed),
  );
  const { db, close } = createDb(evalUrl, { max: 4 });
  const results: ScenarioResult[] = [];
  try {
    for (const s of scenarios) {
      process.stdout.write(`• ${s.id} … `);
      const r = await runScenario(db, s, new RoutingLlm(db, null, model));
      results.push(r);
      console.log(r.error ? `ERROR ${r.error}` : summarise(r));
    }
  } finally {
    await close();
    await flushTelemetry();
  }

  const report = aggregate(results);
  printReport(report, results);
  const sha = gitSha();
  mkdirSync(path.join(here, 'results'), { recursive: true });
  const modelTag =
    model === DEFAULT_MODEL ? '' : `.${model.provider}-${model.model.replace(/[^\w.-]/g, '_')}`;
  const file = path.join(here, 'results', `${sha}${modelTag}${filter ? '.local' : ''}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        sha,
        model: `${model.provider}:${model.model}`,
        at: new Date().toISOString(),
        report,
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
  if (report.forbiddenActions > 0 || report.errors > 0) process.exitCode = 1;
}

/** All scenarios, including evals/scenarios/harvested/. */
export function loadScenarios(dir = path.join(here, 'scenarios')): Scenario[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => {
      const parsed = scenarioSchema.safeParse(parseYaml(readFileSync(path.join(dir, f), 'utf8')));
      if (!parsed.success) throw new Error(`${f}: ${z.prettifyError(parsed.error)}`);
      if (!parsed.data.messages && !parsed.data.steps)
        throw new Error(`${f}: needs messages or steps`);
      return parsed.data;
    });
}

function stepsOf(s: Scenario): Step[] {
  return s.steps ?? (s.messages ?? []).map((tenant) => ({ tenant }));
}

export async function runScenario(
  db: Db,
  s: Scenario,
  llm: LlmClient = new RoutingLlm(db, null),
): Promise<ScenarioResult> {
  const started = Date.now();
  const org = ORG.harbourCity;
  let clock = SEED_TIME;
  const deps: AgentDeps = { db, llm, now: () => clock };
  await db.execute(sql`TRUNCATE TABLE llm_calls, audit_log RESTART IDENTITY CASCADE`);
  await seed(db, SEED_TIME);
  const tenantId = primaryTenantFor(currentTenancyFor(PROPERTY[s.property]).id);
  const [property] = await db
    .select({ pmId: properties.propertyManagerId })
    .from(properties)
    .where(eq(properties.id, PROPERTY[s.property]));

  let jobId: string | null = null;
  let stoppedEarly: string | undefined;
  try {
    const steps = stepsOf(s);
    for (const [i, st] of steps.entries()) {
      // The agent may hand the job to a PM (or finish) earlier than the script expects — e.g.
      // flagging an injection at triage. Remaining steps are moot; score the outcome as is.
      if (jobId && !('pm' in st && st.pm === 'hand_back')) {
        const current = await getJob(db, org, jobId);
        if (
          current.state === 'ESCALATED' ||
          current.state === 'CLOSED' ||
          current.state === 'CANCELLED'
        ) {
          stoppedEarly = `${current.state} before step ${i + 1}/${steps.length}`;
          break;
        }
      }
      if ('tenant' in st || 'tradie' in st) {
        const job = jobId ? await getJob(db, org, jobId) : null;
        const sender =
          'tenant' in st
            ? { senderType: 'tenant' as const, senderId: tenantId, body: st.tenant }
            : {
                senderType: 'tradie' as const,
                senderId: job?.assignedTradieId ?? '',
                body: st.tradie,
              };
        if (sender.senderType === 'tradie' && !sender.senderId)
          throw new Error('tradie step but no tradie assigned');
        const m = await ingestMessage(db, { organizationId: org, jobId, ...sender });
        jobId = m.jobId;
        await advanceJob(deps, { organizationId: org, jobId, messageId: m.messageId });
      } else if ('pm' in st) {
        if (!jobId || !property) throw new Error('pm step before a job exists');
        if (st.pm === 'hand_back') {
          await handBackJob(db, {
            organizationId: org,
            jobId,
            propertyManagerId: property.pmId,
            note: null,
            now: clock,
          });
        } else {
          const [pending] = await db
            .select({ id: approvals.id })
            .from(approvals)
            .where(and(eq(approvals.jobId, jobId), eq(approvals.status, 'pending')));
          if (!pending) throw new Error(`pm ${st.pm}: no pending approval`);
          await recordApprovalDecision(db, {
            organizationId: org,
            approvalId: pending.id,
            decision: st.pm === 'approve' ? 'approved' : 'rejected',
            decidedBy: 'eval-pm',
            note: null,
            now: clock,
          });
        }
        await advanceJob(deps, { organizationId: org, jobId });
      } else {
        clock = new Date(clock.getTime() + st.wait * 3_600_000);
        for (const fu of await listDueFollowUps(db, clock)) await handleFollowUp(deps, fu.id);
      }
    }
    if (!jobId) throw new Error('no job');
    return { ...(await score(db, s, jobId, started)), ...(stoppedEarly ? { stoppedEarly } : {}) };
  } catch (err) {
    return {
      id: s.id,
      urgency: null,
      trade: null,
      state: 'ERROR',
      escalated: false,
      expectedEscalate: s.expect.escalate ?? null,
      checks: {},
      missingActions: [],
      forbiddenHits: [],
      llmCalls: 0,
      unpricedCalls: 0,
      costUsdMicros: 0,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function score(db: Db, s: Scenario, jobId: string, started: number): Promise<ScenarioResult> {
  const job = await getJob(db, ORG.harbourCity, jobId);
  const watched = [...new Set([...s.expect.actions, ...s.expect.forbidden])];
  const succeeded = watched.length
    ? new Set(
        (
          await db
            .select({ action: auditLog.action })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.jobId, jobId),
                eq(auditLog.outcome, 'ok'),
                inArray(auditLog.action, watched),
              ),
            )
        ).map((r) => r.action),
      )
    : new Set<string>();
  const [usage] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      micros: sql<number>`coalesce(sum(${llmCalls.costUsdMicros}), 0)::int`,
      unpriced: sql<number>`count(*) filter (where ${llmCalls.costUsdMicros} is null)::int`,
    })
    .from(llmCalls)
    .where(eq(llmCalls.jobId, jobId));
  const e = s.expect;
  const escalated = job.state === 'ESCALATED';
  const diagnostics = await diagnose(db, jobId);
  const replies = e.replyScript
    ? await db
        .select({ body: messages.body })
        .from(messages)
        .where(
          and(
            eq(messages.jobId, jobId),
            eq(messages.direction, 'outbound'),
            eq(messages.recipientType, 'tenant'),
          ),
        )
    : [];
  const missingActions = e.actions.filter((a) => !succeeded.has(a));
  return {
    id: s.id,
    urgency: job.urgency,
    trade: job.trade,
    state: job.state,
    escalated,
    expectedEscalate: e.escalate ?? null,
    checks: {
      ...(e.urgency && { urgency: job.urgency !== null && e.urgency.includes(job.urgency) }),
      ...(e.trade && { trade: job.trade !== null && e.trade.includes(job.trade) }),
      ...(e.escalate !== undefined && { escalate: escalated === e.escalate }),
      ...(e.state && { state: e.state.includes(job.state) }),
      ...(e.estimateCents !== undefined && { estimate: job.estimateCents === e.estimateCents }),
      ...(e.actions.length > 0 && { actions: missingActions.length === 0 }),
      ...(e.replyScript && {
        language: replies.length > 0 && replies.every((r) => scriptOf(r.body) === e.replyScript),
      }),
    },
    missingActions,
    forbiddenHits: e.forbidden.filter((a) => succeeded.has(a)),
    llmCalls: usage?.calls ?? 0,
    unpricedCalls: usage?.unpriced ?? 0,
    costUsdMicros: usage?.micros ?? 0,
    diagnostics,
    latencyMs: Date.now() - started,
  };
}

/** Coarse script detection: any CJK ideograph → cjk, otherwise latin. Enough to catch a reply
 * in the wrong language without a language-ID dependency. */
export function scriptOf(text: string): 'latin' | 'cjk' {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text) ? 'cjk' : 'latin';
}

async function diagnose(
  db: Db,
  jobId: string,
): Promise<NonNullable<ScenarioResult['diagnostics']>> {
  const rows = await db
    .select({
      action: auditLog.action,
      reason: auditLog.reason,
      outcome: auditLog.outcome,
      output: auditLog.output,
    })
    .from(auditLog)
    .where(eq(auditLog.jobId, jobId))
    .orderBy(auditLog.id);
  const esc = rows.filter((r) => r.action === 'job.escalation_package').at(-1);
  const tri = rows.find((r) => r.action === 'agent.triage')?.output as
    | {
        triage?: { confidence: number; needsMoreInfo: boolean; flags: Record<string, boolean> };
        decision?: { action: string; reasons?: string[] };
      }
    | undefined;
  return {
    ...(esc?.reason ? { escalationReason: esc.reason } : {}),
    ...(tri?.triage && tri.decision
      ? {
          triage: {
            confidence: tri.triage.confidence,
            needsMoreInfo: tri.triage.needsMoreInfo,
            flags: Object.entries(tri.triage.flags)
              .filter(([, v]) => v)
              .map(([k]) => k),
            decision: tri.decision.action,
            reasons: tri.decision.reasons ?? [],
          },
        }
      : {}),
    lastAudit: rows
      .slice(-4)
      .map((r) => `${r.action}:${r.outcome}${r.reason ? ` (${r.reason.slice(0, 80)})` : ''}`),
  };
}

function aggregate(results: ScenarioResult[]) {
  const ok = results.filter((r) => !r.error);
  const rate = (k: CheckName) => {
    const scored = ok.filter((r) => r.checks[k] !== undefined);
    return scored.length ? scored.filter((r) => r.checks[k]).length / scored.length : null;
  };
  const withExp = ok.filter((r) => r.expectedEscalate !== null);
  const tp = withExp.filter((r) => r.escalated && r.expectedEscalate).length;
  const fp = withExp.filter((r) => r.escalated && !r.expectedEscalate).length;
  const fn = withExp.filter((r) => !r.escalated && r.expectedEscalate).length;
  const cost = results.reduce((n, r) => n + r.costUsdMicros, 0);
  const passed = ok.filter(
    (r) => !Object.values(r.checks).includes(false) && r.forbiddenHits.length === 0,
  );
  return {
    scenarios: results.length,
    passed: passed.length,
    errors: results.length - ok.length,
    urgencyAccuracy: rate('urgency'),
    tradeAccuracy: rate('trade'),
    escalationAccuracy: rate('escalate'),
    escalationPrecision: tp + fp ? tp / (tp + fp) : null,
    escalationRecall: tp + fn ? tp / (tp + fn) : null,
    stateAccuracy: rate('state'),
    actionsAccuracy: rate('actions'),
    languageAccuracy: rate('language'),
    forbiddenActions: results.reduce((n, r) => n + r.forbiddenHits.length, 0),
    totalCostUsd: cost / 1e6,
    unpricedCalls: results.reduce((n, r) => n + r.unpricedCalls, 0),
    meanCostPerScenarioUsd: results.length ? cost / 1e6 / results.length : 0,
    meanLlmCallsPerScenario: results.length
      ? results.reduce((n, r) => n + r.llmCalls, 0) / results.length
      : 0,
    meanLatencyMs: results.length
      ? Math.round(results.reduce((n, r) => n + r.latencyMs, 0) / results.length)
      : 0,
  };
}

function summarise(r: ScenarioResult) {
  const marks = Object.entries(r.checks)
    .map(([k, v]) => `${k}:${v ? '✓' : '✗'}`)
    .join(' ');
  const extra = [
    r.missingActions.length ? `missing:${r.missingActions.join(',')}` : '',
    r.forbiddenHits.length ? `FORBIDDEN:${r.forbiddenHits.join(',')}` : '',
    r.stoppedEarly ? `(stopped early: ${r.stoppedEarly})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const failed = Object.values(r.checks).includes(false) || r.forbiddenHits.length > 0;
  const d = r.diagnostics;
  const why =
    failed && d
      ? `\n    why: ${d.escalationReason ? `escalated: ${d.escalationReason}; ` : ''}${d.triage ? `triage conf ${d.triage.confidence} needsMoreInfo=${String(d.triage.needsMoreInfo)} flags=[${d.triage.flags.join(',')}] → ${d.triage.decision}` : ''}\n    last: ${(d.lastAudit ?? []).join(' | ')}`
      : '';
  const cost = r.unpricedCalls
    ? `cost unknown (${r.unpricedCalls} unpriced calls)`
    : `$${(r.costUsdMicros / 1e6).toFixed(3)}`;
  return `${r.state} (${r.urgency ?? '-'}/${r.trade ?? '-'}) ${marks} ${extra} ${cost}${why}`;
}

function printReport(report: ReturnType<typeof aggregate>, results: ScenarioResult[]) {
  const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`);
  console.log('\n── Eval report ─────────────────────────────');
  console.log(
    `scenarios            ${report.scenarios} (${report.passed} passed, ${report.errors} errors)`,
  );
  console.log(`urgency accuracy     ${pct(report.urgencyAccuracy)}`);
  console.log(`trade accuracy       ${pct(report.tradeAccuracy)}`);
  console.log(
    `escalation accuracy  ${pct(report.escalationAccuracy)}  (precision ${pct(report.escalationPrecision)}, recall ${pct(report.escalationRecall)})`,
  );
  console.log(`final state accuracy ${pct(report.stateAccuracy)}`);
  console.log(`required actions     ${pct(report.actionsAccuracy)}`);
  console.log(`reply language       ${pct(report.languageAccuracy)}`);
  console.log(
    `forbidden actions    ${report.forbiddenActions}${report.forbiddenActions ? '  ← must be 0' : ''}`,
  );
  console.log(
    `cost                 US$${report.totalCostUsd.toFixed(3)} total, US$${report.meanCostPerScenarioUsd.toFixed(3)}/scenario, ${report.meanLlmCallsPerScenario.toFixed(1)} calls/scenario`,
  );
  if (report.unpricedCalls) {
    console.log(
      `                     ${report.unpricedCalls} calls have no price (set LLM_PRICES_JSON) — total above excludes them`,
    );
  }
  console.log(`latency              ${report.meanLatencyMs} ms/scenario`);
  const failing = results.filter(
    (r) => r.error || Object.values(r.checks).includes(false) || r.forbiddenHits.length,
  );
  if (failing.length) console.log(`failing: ${failing.map((r) => r.id).join(', ')}`);
}

/** Separate database so evals never touch dev or test data. */
async function ensureEvalDatabase(baseUrl: string): Promise<string> {
  const url = new URL(baseUrl);
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname)) {
    throw new Error('Evals only run against a local database');
  }
  const evalUrl = new URL(baseUrl);
  evalUrl.pathname = '/keyhook_eval';
  const admin = createDb(baseUrl, { max: 1 });
  try {
    await admin.db.execute(sql`CREATE DATABASE keyhook_eval`);
  } catch {
    /* already exists */
  } finally {
    await admin.close();
  }
  await runMigrations(evalUrl.toString());
  return evalUrl.toString();
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
