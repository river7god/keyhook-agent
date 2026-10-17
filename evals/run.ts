/**
 * pnpm eval — run every scenario in evals/scenarios/ against the real model (spec §10).
 *
 * For each scenario: reset a dedicated eval database, seed, send the tenant message(s) through
 * the same ingest + advanceJob path as production (ClaudeLlm, real tools, mock outbox), then
 * score the resulting job against `expect`. Writes evals/results/<git-sha>.json.
 *
 * Costs real money: roughly 3–5 Claude calls per scenario. Requires ANTHROPIC_API_KEY.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { advanceJob } from '@/agent/advance';
import { AGENT_MODEL, ClaudeLlm } from '@/agent/llm';
import { createDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { auditLog, llmCalls, tradeEnum, urgencyEnum } from '@/db/schema';
import { currentTenancyFor, primaryTenantFor } from '@/db/seed/data/tenancies';
import { ORG, PROPERTY } from '@/db/seed/ids';
import { JOB_STATES } from '@/workflows/job-states';
import { seed } from '@/db/seed/seed';
import { ingestMessage } from '@/domain/inbound';
import { getJob } from '@/domain/jobs';

const scenarioSchema = z.object({
  id: z.string(),
  property: z.enum(Object.keys(PROPERTY) as [keyof typeof PROPERTY, ...(keyof typeof PROPERTY)[]]),
  messages: z.array(z.string()).min(1),
  expect: z.object({
    urgency: z.array(z.enum(urgencyEnum.enumValues)).optional(),
    trade: z.array(z.enum(tradeEnum.enumValues)).optional(),
    escalate: z.boolean().optional(),
    /** Accepted final job states after all messages. */
    state: z.array(z.enum(JOB_STATES)).optional(),
    forbidden: z.array(z.string()).default([]),
  }),
});
type Scenario = z.infer<typeof scenarioSchema>;

interface ScenarioResult {
  id: string;
  urgency: string | null;
  trade: string | null;
  escalated: boolean;
  expectedEscalate: boolean | null;
  state: string;
  checks: { urgency?: boolean; trade?: boolean; escalate?: boolean; state?: boolean };
  forbiddenHits: string[];
  costUsdMicros: number;
  latencyMs: number;
  error?: string;
}

const here = path.dirname(new URL(import.meta.url).pathname);

async function main() {
  try {
    process.loadEnvFile(path.join(here, '..', '.env'));
  } catch {
    /* CI provides env */
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      'pnpm eval: ANTHROPIC_API_KEY is not set (add it to .env). Evals call the real model.',
    );
    process.exit(2);
  }
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is not set');
  const evalUrl = await ensureEvalDatabase(baseUrl);

  const filter = process.argv[2];
  const scenarios = readdirSync(path.join(here, 'scenarios'))
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) =>
      scenarioSchema.parse(parseYaml(readFileSync(path.join(here, 'scenarios', f), 'utf8'))),
    )
    .filter((s) => !filter || s.id.includes(filter));

  const { db, close } = createDb(evalUrl, { max: 4 });
  const results: ScenarioResult[] = [];
  try {
    for (const s of scenarios) {
      process.stdout.write(`• ${s.id} … `);
      const r = await runScenario(db, s);
      results.push(r);
      console.log(r.error ? `ERROR ${r.error}` : summarise(r));
    }
  } finally {
    await close();
  }

  const report = aggregate(results);
  printReport(report, results);
  const sha = gitSha();
  mkdirSync(path.join(here, 'results'), { recursive: true });
  const file = path.join(here, 'results', `${sha}${filter ? '.local' : ''}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { sha, model: AGENT_MODEL, at: new Date().toISOString(), report, results },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
  if (report.forbiddenActions > 0) process.exitCode = 1;
}

async function runScenario(
  db: ReturnType<typeof createDb>['db'],
  s: Scenario,
): Promise<ScenarioResult> {
  const started = Date.now();
  const org = ORG.harbourCity;
  await db.execute(sql`TRUNCATE TABLE llm_calls, audit_log RESTART IDENTITY CASCADE`);
  await seed(db);
  const tenantId = primaryTenantFor(currentTenancyFor(PROPERTY[s.property]).id);
  try {
    let jobId: string | null = null;
    for (const body of s.messages) {
      const m = await ingestMessage(db, {
        organizationId: org,
        senderType: 'tenant',
        senderId: tenantId,
        jobId,
        body,
      });
      jobId = m.jobId;
      await advanceJob(
        { db, llm: new ClaudeLlm(db), now: () => new Date() },
        { organizationId: org, jobId, messageId: m.messageId },
      );
    }
    if (!jobId) throw new Error('no job');
    const job = await getJob(db, org, jobId);
    const forbiddenHits = s.expect.forbidden.length
      ? (
          await db
            .select({ action: auditLog.action })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.jobId, jobId),
                eq(auditLog.outcome, 'ok'),
                inArray(auditLog.action, s.expect.forbidden),
              ),
            )
        ).map((r) => r.action)
      : [];
    const [cost] = await db
      .select({ micros: sql<number>`coalesce(sum(${llmCalls.costUsdMicros}), 0)::int` })
      .from(llmCalls)
      .where(eq(llmCalls.jobId, jobId));
    const escalated = job.state === 'ESCALATED';
    return {
      id: s.id,
      urgency: job.urgency,
      trade: job.trade,
      escalated,
      expectedEscalate: s.expect.escalate ?? null,
      state: job.state,
      checks: {
        ...(s.expect.urgency && {
          urgency: job.urgency !== null && s.expect.urgency.includes(job.urgency),
        }),
        ...(s.expect.trade && { trade: job.trade !== null && s.expect.trade.includes(job.trade) }),
        ...(s.expect.escalate !== undefined && { escalate: escalated === s.expect.escalate }),
        ...(s.expect.state && { state: s.expect.state.includes(job.state) }),
      },
      forbiddenHits,
      costUsdMicros: cost?.micros ?? 0,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      id: s.id,
      urgency: null,
      trade: null,
      escalated: false,
      expectedEscalate: s.expect.escalate ?? null,
      state: 'ERROR',
      checks: {},
      forbiddenHits: [],
      costUsdMicros: 0,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function aggregate(results: ScenarioResult[]) {
  const rate = (k: keyof ScenarioResult['checks']) => {
    const scored = results.filter((r) => r.checks[k] !== undefined);
    return scored.length ? scored.filter((r) => r.checks[k]).length / scored.length : null;
  };
  // Escalation precision/recall over scenarios that state an expectation.
  const withExp = results.filter((r) => r.expectedEscalate !== null && !r.error);
  const tp = withExp.filter((r) => r.escalated && r.expectedEscalate).length;
  const fp = withExp.filter((r) => r.escalated && !r.expectedEscalate).length;
  const fn = withExp.filter((r) => !r.escalated && r.expectedEscalate).length;
  const cost = results.reduce((s, r) => s + r.costUsdMicros, 0);
  return {
    scenarios: results.length,
    errors: results.filter((r) => r.error).length,
    urgencyAccuracy: rate('urgency'),
    tradeAccuracy: rate('trade'),
    escalationAccuracy: rate('escalate'),
    stateAccuracy: rate('state'),
    escalationPrecision: tp + fp ? tp / (tp + fp) : null,
    escalationRecall: tp + fn ? tp / (tp + fn) : null,
    forbiddenActions: results.reduce((s, r) => s + r.forbiddenHits.length, 0),
    totalCostUsd: cost / 1e6,
    meanCostPerScenarioUsd: results.length ? cost / 1e6 / results.length : 0,
    meanLatencyMs: results.length
      ? Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)
      : 0,
  };
}

function summarise(r: ScenarioResult) {
  const marks = Object.entries(r.checks)
    .map(([k, v]) => `${k}:${v ? '✓' : '✗'}`)
    .join(' ');
  const forbidden = r.forbiddenHits.length ? ` FORBIDDEN:${r.forbiddenHits.join(',')}` : '';
  return `${r.state} (${r.urgency ?? '-'}/${r.trade ?? '-'}) ${marks}${forbidden} $${(r.costUsdMicros / 1e6).toFixed(3)}`;
}

function printReport(report: ReturnType<typeof aggregate>, results: ScenarioResult[]) {
  const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`);
  console.log('\n── Eval report ─────────────────────────────');
  console.log(`scenarios            ${report.scenarios} (${report.errors} errors)`);
  console.log(`urgency accuracy     ${pct(report.urgencyAccuracy)}`);
  console.log(`trade accuracy       ${pct(report.tradeAccuracy)}`);
  console.log(
    `escalation accuracy  ${pct(report.escalationAccuracy)}  (precision ${pct(report.escalationPrecision)}, recall ${pct(report.escalationRecall)})`,
  );
  console.log(
    `forbidden actions    ${report.forbiddenActions}${report.forbiddenActions ? '  ← must be 0' : ''}`,
  );
  console.log(
    `cost                 US$${report.totalCostUsd.toFixed(3)} total, US$${report.meanCostPerScenarioUsd.toFixed(3)}/scenario`,
  );
  console.log(`latency              ${report.meanLatencyMs} ms/scenario`);
  const failed = results.filter(
    (r) => r.error || Object.values(r.checks).includes(false) || r.forbiddenHits.length,
  );
  if (failed.length) console.log(`failing: ${failed.map((r) => r.id).join(', ')}`);
}

/** Separate database so evals never touch dev or test data. */
async function ensureEvalDatabase(baseUrl: string): Promise<string> {
  const url = new URL(baseUrl);
  const evalUrl = new URL(baseUrl);
  evalUrl.pathname = '/keyhook_eval';
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname)) {
    throw new Error('Evals only run against a local database');
  }
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

await main();
