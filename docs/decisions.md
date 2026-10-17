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

### 2026-10-17 — Quotes stored GST-inclusive (proposed — confirm)
**Decision:** `estimate_cents` is GST-inclusive. A quote stated "+GST" has 15% added; unclear GST
status is treated as inclusive and noted in the audit log.
**Reason:** Approval limits must compare like with like. Needs product-owner confirmation.

### 2026-10-17 — In-house eval runner for M1; promptfoo decision deferred to M4
**Decision:** `pnpm eval` runs YAML scenarios through the real ingest + agent path on a separate
`keyhook_eval` database and scores spec §10 metrics. Results saved per commit in
`evals/results/`. Whether to adopt promptfoo is decided in M4 when the suite reaches 50+ scenarios.
**Reason:** CLAUDE.md requires an eval score for any agent change from M1 on; the scenario format
is promptfoo-agnostic.
