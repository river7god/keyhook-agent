English | [简体中文](decisions.zh-CN.md)

# Architecture decisions

Newest last. Each entry: date, decision, reason. Dates are NZ local.

---

### 2026-10-17 — Modular monolith, API-first; not microservices
**Decision:** One Next.js app. Business rules live in `src/domain/` and are the only path to the
database for every caller: dashboard pages, `/api/v1` routes, agent tools and Inngest functions.
External systems sit behind ports in `src/adapters/`.
**Reason:** One developer, and the core guarantees (state transition + audit row + idempotency
record committed atomically) rely on a single Postgres transaction. Microservices would turn that
into sagas/outboxes for no product gain. Clear module boundaries keep later extraction cheap; the
Inngest worker is the natural first candidate.

### 2026-10-17 — Multi-tenant SaaS from day one; tenant = `organization`
**Decision:** Every business table has `organization_id NOT NULL`. Child tables use composite
foreign keys `(organization_id, x_id)` so the database rejects cross-organization references.
Domain functions take `organizationId` explicitly. Postgres RLS is deferred to M5 as a second
line of defence.
**Reason:** Retrofitting tenancy touches every table, query and test. "Tenant" already means a
renter in this domain, so the SaaS tenant is called *organization* (a property-management agency).

### 2026-10-17 — Three-tier spend approval with a global fallback
**Decision:** `effective PM limit = min(property_managers.auto_approve_limit_cents ??
organizations.default_pm_auto_approve_limit_cents, owners.approval_limit_cents)`.
Estimate ≤ effective → auto-approve; ≤ owner limit → PM approval; above → escalate.
Implemented in `src/domain/approval-policy.ts`.
**Reason:** PM experience varies (per-person limit), organizations need a default, and a PM's
auto-approval must never exceed what the owner has authorised (the `min` cap).

### 2026-10-17 — Schema additions beyond spec §9
**Decision:** Added `organizations`, `property_managers`, `tenancy_tenants` (many-to-many),
`idempotency_keys`, `jobs.source` / `created_by_*` (nullable `reported_by_tenant_id`),
`jobs.state_before_escalation`, `jobs.version`.
**Reason:** Multi-tenancy; flatmates share tenancies; jobs can originate from PMs, inspections or
the agent itself; a PM "hands back" an escalation to the prior state; optimistic locking on
transitions; rule 3 needs a durable store of idempotent responses.

### 2026-10-17 — Trades enum adds `other`, not `general`
**Decision:** `plumbing | electrical | heating | handyman | locksmith | other`.
**Reason:** `handyman` already is the general-repairs trade; a separate `general` would overlap and
make triage flip between them. `other` is the explicit "can't classify → PM" outlet.

### 2026-10-17 — Invariants enforced in the database, not only in code
**Decision:** CHECK constraints and partial unique indexes for: escalation consistency, outbound
messages need an idempotency key, one pending approval per job, one primary contact per tenancy,
non-negative cents, confidence 0–1. `audit_log` is append-only via a trigger (UPDATE/DELETE
rejected; TRUNCATE allowed for dev/test only — production roles must not hold TRUNCATE).
**Reason:** Rules 2–4 must hold even if application code has a bug or someone uses a SQL console.

### 2026-10-17 — State machine in code; LLM gets a menu
**Decision:** `src/workflows/state-machine.ts` owns transitions. ESCALATED is reachable from any
non-terminal state; leaving it is PM-only and only back to `state_before_escalation`. CANCELLED is
PM-only. CLOSED and CANCELLED are terminal. The model is only ever offered
`allowedTransitions()`. Confirmed with product owner 2026-10-17: terminal jobs cannot be
escalated; a PM cannot close directly from ESCALATED (hand back or cancel); a rejected spend
approval leads to escalation (implemented in M2).
**Reason:** CLAUDE.md rule 1 / spec §5.

### 2026-10-17 — No auth in M0; plain-string PM identity
**Decision:** `approvals.decided_by` and `audit_log.actor_id` are text. Pages act as the
organization in `DEV_ORGANIZATION_SLUG`.
**Reason:** Auth is out of v1 scope; string ids are trivially migrated to user FKs later.

### 2026-10-17 — Tooling and versions
**Decision:** Node 24 LTS, pnpm 10, Next 16, React 19, TypeScript 6 (not 7 — typescript-eslint
supports < 6.1), ESLint 9 flat config (not 10 — eslint-config-next plugins), Vitest 5 with separate
`unit` and `db` projects, postgres.js driver, Inngest dev server via pinned `inngest-cli`. All
versions pinned exactly and at least two weeks old at install time. Postgres 17 in Docker on host
port 54329.
**Reason:** Compatibility of the lint toolchain; reproducible installs; DB tests run serially
against a dedicated `keyhook_test` database rebuilt from migrations each run.

### 2026-10-17 — Playwright deferred to M2/M3
**Decision:** No e2e tooling in M0; `pnpm test:e2e` is added with the first real UI flow.
**Reason:** M0 UI is a placeholder; unit + DB integration tests give better signal for now.

### 2026-10-17 — Seed data is hand-written and deterministic
**Decision:** Fixed UUIDs (`src/db/seed/ids.ts`), no faker. A second one-property organization
exists to test isolation. 15 Harbour City tenancies = 10 current + 5 ended (history).
**Reason:** Tests, evals and the simulator reference fixtures by name; edge cases are deliberate.

### 2026-10-17 — Bilingual docs: English canonical, Chinese alongside
**Decision:** Every document has an English `X.md` and a Simplified Chinese `X.zh-CN.md` next to
it, linked to each other on the first line. English is canonical; a change is not done until both
versions are updated. `CLAUDE.zh-CN.md` is a reference translation — Claude Code loads `CLAUDE.md`.
**Reason:** The product owner works in Chinese; the portfolio audience reads English.

### 2026-10-17 — Agent catalog and human/agent boundaries
**Decision:** `docs/agents.md` classifies agents by trigger (reactive / proactive / human-invoked)
× autonomy (suggest / act with approval / act autonomously), refined per action via tool
permission levels, and defines an autonomy matrix per domain. Rows outside maintenance are
proposals until confirmed.
**Reason:** Gives the roadmap (Portfolio Monitor next, arrears as the second workflow) and the
escalation/approval rules a single reference.

### 2026-10-17 — M1 agent shape: extract → code decides → compose
**Decision:** Each job state has a handler. The LLM extracts facts into a Zod schema (triage,
quote reply, slot choice, progress, confirmation); code applies policy (spec §7 escalation rules,
approval policy, state machine); the LLM then writes tenant-facing text. Only TRIAGED uses a
model-driven tool loop, limited to five tools, and its outcome is self-checked (must end in
AWAITING_QUOTE or ESCALATED). Each handler commits all its effects in one transaction; messages
are delivered after commit; inbound messages are processed at most once. In M1 every
off-happy-path outcome escalates (clarifying, re-offering, reassignment arrive in M2).
**Reason:** Decisions that carry money, legal or safety weight stay deterministic and testable;
the model does language work. Matches `docs/agents.md` §3.2.

### 2026-10-17 — Model and request settings
**Decision:** `claude-opus-5-5` for every step (product owner's choice). Effort set explicitly:
`medium` for triage/interpretation/tool loop, `low` for composing tenant messages. Server-side
refusal fallback on (`fallbacks: "default"`); a final refusal escalates. Structured outputs via
`output_config.format` (forced tool_choice is not supported on this model). Top-level prompt
caching with static system prompts. Cheaper models only after evals show no quality loss.
**Reason:** One model keeps one cache namespace and one behaviour to evaluate.

### 2026-10-17 — Configurable tradie selection
**Decision:** `organizations.tradie_selection` (Zod-validated JSON): `strategy` `rules` (top score
wins) or `llm` (model picks from the top-N shortlist with a reason); weights for rating,
availability (earliest free slot within a horizon, from `tradie_availability`), familiarity
(past jobs at the property) and workload (open jobs). Hard eligibility (active, trade, suburb,
emergency call-outs) is always code; `request_quote` re-checks the tradie is selectable.
**Reason:** Agencies differ in how they choose tradies; the model can never pick an ineligible one.

### 2026-10-17 — LLM cost tracked in USD micro-dollars
**Decision:** `llm_calls` stores tokens, latency and `cost_usd_micros` per request (null for models
without a known price). Business money remains NZD cents.
**Reason:** API cost is an operating metric billed in USD (spec §10 "cost per job").

### 2026-10-17 — Quotes stored GST-inclusive
**Decision:** `estimate_cents` is GST-inclusive. A quote stated "+GST" has 15% added; unclear GST
status is treated as inclusive and noted in the audit log.
**Reason:** Approval limits must compare like with like. Confirmed with product owner 2026-10-17.

### 2026-10-17 — In-house eval runner for M1; promptfoo decision deferred to M4
**Decision:** `pnpm eval` runs YAML scenarios through the real ingest + agent path on a separate
`keyhook_eval` database and scores spec §10 metrics. Results saved per commit in
`evals/results/`. Whether to adopt promptfoo is decided in M4 when the suite reaches 50+ scenarios.
**Reason:** CLAUDE.md requires an eval score for any agent change from M1 on; the scenario format
is promptfoo-agnostic.

### 2026-10-17 — M2 follow-up and retry policy (configurable per organization)
**Decision:** `organizations.workflow_policy` (Zod-validated JSON) with agreed defaults: clarify up
to 2 rounds; tenant waits (clarify, slot choice) remind at 24h and escalate 24h later; completion
confirmation reminds at 48h, escalates 72h later; quote reminders at 1h/4h/24h by urgency, 2
reminders then reassign; at most 3 tradies tried; slots offered at most twice; post-visit check
4h after the slot ends, escalate 24h later; PM approval reminder at 24h; no reminders 20:00–08:00
NZ time (postponed to 08:00).
**Reason:** Agencies run different service levels; the numbers are business rules, not code.

### 2026-10-17 — Follow-ups: DB as source of truth, sweeper + per-job serialisation
**Decision:** At most one `scheduled` follow-up per job (partial unique index). Any state
transition or reply from the job's parties marks it `satisfied`; after every advance the job's
current wait gets a fresh one. A 5-minute Inngest cron emits `followup/due` per due row (event id
dedupes); the handler claims the row (`scheduled → sent`) before acting. All job-mutating Inngest
functions share one env-scoped concurrency key per job.
**Reason:** Durable without per-follow-up sleeping functions or cancellation plumbing; a lost
event is retried by the next sweep; duplicates cannot double-send.

### 2026-10-17 — Clarifying instead of escalating when information is the only gap
**Decision:** If triage reports `needsMoreInfo` and the only other triggers are low confidence or
an unclassifiable trade, the agent asks the tenant (RECEIVED/NEEDS_INFO → TRIAGED → NEEDS_INFO)
rather than escalating; any other trigger still escalates. After the round limit it escalates.
**Reason:** Spec §7's low-confidence rule exists to avoid guessing; asking is the cheaper fix and
the escalation still happens if asking doesn't help.

### 2026-10-17 — PM approval path
**Decision:** Quote above the effective PM limit but within the owner limit → `request_approval`
(pending record, AWAITING_APPROVAL, PM notified). The PM's decision is written first (as the
PM), then `approve_spend` runs with the PM as actor; executeTool refuses it without a stored
approved record. Rejection escalates. Each approval can be decided once. Until auth exists the PM
selects their identity from the organization's PMs.
**Reason:** CLAUDE.md rule 2 and spec §5/§8.

### 2026-10-17 — Hand-back semantics (proposed — confirm)
**Decision:** Handing back means the PM has resolved what caused the escalation. The job returns
to the state it was escalated from (as already agreed). For a job escalated at triage, the PM's
hand-back accepts the recorded urgency/trade (which the PM may correct) and the agent proceeds to
arranging a quote without re-triaging; new tenant messages are still triaged normally.
**Reason:** Re-triaging the same message would reproduce the same escalation (e.g. the original
gas smell) and loop.

### 2026-10-17 — Dashboard is server-rendered over the domain layer; mutations via /api/v1
**Decision:** Dashboard pages are React Server Components reading through `src/domain` (no
client data fetching for reads). Every PM mutation goes through a Zod-validated `/api/v1` route
that calls the same services the agent uses, audited with the PM as actor. Plain CSS with design
tokens; no UI library yet.
**Reason:** API-first without duplicating read endpoints; one code path for every write.

### 2026-10-17 — Tracing via OpenTelemetry/OTLP; Langfuse is a configured backend
**Decision:** The app registers an OpenTelemetry tracer provider only when
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (or `OTEL_EXPORTER_OTLP_ENDPOINT`) is set and exports over
OTLP/HTTP — pointing it at Langfuse's OTLP endpoint gives Langfuse tracing without its SDK. Each
Claude request gets a `gen_ai.*` span (model, tokens, cost, step, effort); `job.advance` is the
root span; audit rows store the active trace id. Spans carry metadata only, no prompt text.
The Anthropic SDK's built-in tracing is not used yet: no release with it is two weeks old.
**Reason:** Standard instrumentation, swappable backend, no vendor SDK; tenant message content
stays out of the tracing backend by default (PII).

### 2026-10-17 — Eval suite shape and cadence
**Decision:** 60 YAML scenarios (spec requires ≥50) with multi-step flows and simulated time.
Live runs: `pnpm eval` locally, and a GitHub workflow on demand + nightly (needs the
`ANTHROPIC_API_KEY` secret). Every push runs the key-free checks: scenario validation and the
runner's mechanics against the scripted LLM. Forbidden actions or scenario errors fail the run.
**Reason:** Live evals cost money and are non-deterministic; per-push CI must stay free and stable.

### 2026-10-17 — Multi-issue requests (proposed — confirm)
**Decision:** If one message reports issues needing different trades or separate visits, the agent
escalates so the PM can split them into jobs; several items for the same tradie stay one job.
**Reason:** Silently handling only one issue would drop the other.

### 2026-10-17 — Agent failures escalate; duplicate processing aborts
**Decision:** A model refusal or unusable output escalates the job at once (no retries); any other
error is retried by Inngest and, once retries are exhausted, `onFailure` escalates the job. A run
that finds its inbound message already processed by a concurrent run aborts its transaction.
**Reason:** A stuck job is invisible to the PM; escalation makes every failure a visible task.

### 2026-10-17 — Authentication: per-PM sessions, no auth library
**Decision:** PMs sign in with email + password (scrypt via `node:crypto`). Sessions live in
Postgres; the cookie carries a random token and only its SHA-256 is stored. `proxy.ts` makes the
optimistic cookie check for pages; every page and API route does the authoritative lookup
(`requirePageUser` / `requireApiUser`), enforced by a static test. Seeded PMs share the password
`SEED_PM_PASSWORD` (default `keyhook-demo`, dev/demo only).
**Reason:** RLS needs a real per-user organization; a shared password can't provide one. The
implementation is small, dependency-free and fully tested; swap for an identity provider when
real customers arrive.

### 2026-10-17 — RLS for request-scoped access; workers keep the owner role
**Decision:** Request handlers run inside `withOrg()` (one short transaction, `SET LOCAL ROLE
keyhook_app`, `app.organization_id`), so Postgres filters every organization-scoped table and
rejects cross-organization writes; no context is an error. Background workers (Inngest agent,
follow-ups, evals, seed) use the owner role and pass `organizationId` explicitly, protected by
composite FKs. `sessions` is outside RLS (read before the organization is known).
**Reason:** Agent steps call the LLM and must not hold a transaction open for that long; the
user-facing surface is where an auth or query bug would leak data, so that is where RLS sits.

### 2026-10-17 — Simulator spend guard
**Decision:** New simulator messages are refused (429) past `SIMULATOR_MAX_MESSAGES_PER_HOUR`
(default 60) per organization or once the organization's 24h AI spend reaches
`DAILY_LLM_BUDGET_USD` (default 5). Jobs already running continue.
**Reason:** On a public demo the simulator is the one way an outsider can trigger paid model calls.

### 2026-10-17 — Pluggable model providers; Claude stays the default
**Decision:** `LlmClient` has two implementations: `ClaudeLlm` (Anthropic SDK) and
`OpenAICompatibleLlm` (OpenAI SDK with `baseURL`, covering OpenAI, DeepSeek and Moonshot Kimi).
`organizations.llm_routing` picks a model per step group (triage, retriage, act, interpret,
compose) with a default; null means Claude everywhere. The OpenAI-compatible adapter translates
the Anthropic message/tool shape both ways, so handlers are unchanged; structured output uses
native JSON Schema where supported, otherwise JSON mode with the schema in the prompt, always
Zod-validated with one repair attempt. Keys are environment-only. DeepSeek and Kimi require
`acknowledgeOffshoreProviders: true`. Costs for non-Claude models come from `LLM_PRICES_JSON`
(null otherwise). A model is switched only after `pnpm eval --model provider:model` shows no loss.
**Reason:** Product owner wants flexibility and cost options without forking agent logic; the
privacy gate and eval gate keep the switch deliberate. New dependency: `openai` (official SDK).

### 2026-10-17 — Deployment-wide model default; unpriced calls still count against the budget
**Decision:** `LLM_DEFAULT_MODEL=provider:model` (+ `LLM_ACKNOWLEDGE_OFFSHORE=true` for DeepSeek/Kimi)
sets the model for organizations without `llm_routing`. The simulator's daily budget charges
`UNKNOWN_LLM_CALL_COST_USD` (default 0.05) for each call whose cost is unknown.
**Reason:** The product owner wants to start on Kimi before an Anthropic key; without a price
table the spend guard would otherwise never trip.

### 2026-10-17 — PM corrections become eval scenarios (the improvement loop)
**Decision:** `agent_feedback` stores labelled corrections: a PM flags a mistake on the job page
(urgency, trade, should / should not have escalated, other), and a hand-back that changes
urgency/trade is recorded automatically. Each row snapshots what the agent decided. `pnpm
eval:harvest` turns unharvested rows into YAML scenarios (the job's real messages as steps, the
PM's answer as the expectation) under `evals/scenarios/harvested/`, redacting emails, phone
numbers and known names, and marks them `reviewed: false`; the runner skips unreviewed scenarios
unless `--include-unreviewed`. A person reviews, then sets `reviewed: true` and commits.
**Reason:** The model doesn't learn from production; the system does — every correction becomes a
regression test, so prompt/policy changes are proven against real past mistakes. Review stays
human because production messages contain personal information.
