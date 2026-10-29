English | [简体中文](interview-guide.zh-CN.md)

# Keyhook-agent — System Walkthrough & Interview Guide (2026-10-29)

A study guide: the whole system in one place, end to end, plus the engineering concepts behind
each part, written as interview talking points. Details live in [`spec.md`](spec.md),
[`architecture.md`](architecture.md), [`agent-design.md`](agent-design.md) and
[`decisions.md`](decisions.md); this file links them into one story.

---

## Part A — The system

### A1. The 30-second pitch

> Keyhook-agent takes a New Zealand tenant's maintenance request ("no hot water") from the first
> message to a closed job: triage, find a tradie, get a quote, check spend limits, book a time,
> chase silence, confirm the fix, close. A property manager is pulled in only when judgement or
> authority is needed. It is a **transactional** agent (money, safety, people's homes), so
> **reliability lives in code** — a state machine, durable workflows and a tool gateway — and the
> **model only understands and writes**.

Key line for interviews: **"The model extracts and writes; code decides."**

### A2. Who is involved

| Actor | Does |
|---|---|
| Tenant | Reports the issue (+ photos), answers questions, picks a time, confirms the fix |
| Tradie / supplier | Quotes, visits, reports variations and invoices |
| Owner | Authorises spend above a limit (notified; PM approves on their behalf in v1) |
| Property manager (PM) | Supervises: approvals, escalations, corrections, cancellations |
| Agent | Everything in between |

Business value: one job = 4 people, 3 systems, ~9 manual steps. The PM shifts from **doing** to
**supervising**; an agency can run more properties per PM.

### A3. Layered architecture (modular monolith)

```
 Clients:  PM dashboard (server components) · tenant/tradie simulator · external systems
     │
     ▼
 src/app        Next.js routes & pages: session auth, Zod input, withOrg() → Postgres RLS
     │  emits events
     ▼
 src/workflows  Inngest: job-advance (concurrency 1 per job), follow-up sweeper (5 min),
                arrears sweep, portfolio monitor (daily), media retention, onFailure → escalate
     │
     ▼
 src/agent      advanceJob: state → handler; each handler = extract → code decides → compose
                RoutingLlm: per-step model routing, timeouts, fallback + circuit breaker
     │
     ▼
 src/tools      executeTool gateway: Zod · permission (read/auto/approval) · idempotency · audit
     │
     ▼
 src/domain     business rules + org-scoped data access — the ONLY path to the DB
     │
     ▼
 src/db         Postgres: organization_id on every row, composite FKs, RLS, append-only audit_log
 src/adapters   messaging (mock outbox in dev — no real SMS/email)
```

Why a monolith: one team, one deployment, modules talk via interfaces. Each interface is a
**seam** for later extraction (messaging gateway, LLM gateway, media service) — "strangler, not
rewrite".

### A4. Job state machine (the source of truth)

```
RECEIVED → TRIAGED → NEEDS_INFO ⇄ TRIAGED
TRIAGED → AWAITING_QUOTE → AWAITING_APPROVAL → SCHEDULING   (approval skipped if within PM limit)
SCHEDULING → SCHEDULED → IN_PROGRESS → AWAITING_CONFIRMATION → CLOSED
Any state → ESCALATED   (PM may hand back, but ONLY to the state it left)
Any state → CANCELLED   (PM only)          Terminal: CLOSED, CANCELLED
```

- Code: `src/workflows/state-machine.ts` — `checkTransition()` validates every write;
  `allowedTransitions()` is the only "menu" the model ever sees.
- `transitionJob` uses **optimistic locking** on a `version` column and writes the audit row in
  the same transaction.
- Arrears has its own machine (`src/workflows/arrears-state-machine.ts`):
  `OPEN → REMINDED ⇄ PROMISED → NOTICE_PENDING → NOTICE_SENT`, plus ESCALATED / RESOLVED / CLOSED.

### A5. End-to-end flow of one request

```
1. Tenant: "No hot water since this morning" (+ photo)
2. POST /api/v1/simulator/messages
     → ingestMessage (stored as untrusted, org-scoped) → job created (RECEIVED)
     → Inngest event job.advance.requested
3. Inngest job-advance (concurrency key = jobId, retries 3, onFailure → escalate)
     → advanceJob() loops up to 6 steps until it must wait for someone
4. Photo? vision step → analysis stored (quality check in code first)
5. RECEIVED → triage handler
     LLM structured extraction (urgency, trade, confidence, flags like promptInjection, legal…)
     code decideTriage(): emergency / low confidence / injection / legal / injury / tenant damage
       → ESCALATED with a package (summary, done, recommendation, evidence)
     info missing → NEEDS_INFO + clarifying question
     otherwise → TRIAGED + ack to tenant
6. TRIAGED → the ONLY tool loop (≤ 8 turns): search_tradies → request_quote
     then self-check: did the state really move to AWAITING_QUOTE? if not → escalate
7. Follow-up row scheduled (chase the tradie). advanceJob returns; nothing in memory.
   ── hours / days pass ──
8. Tradie replies with a quote → new event → quote handler
     amount parsed by code (integer cents) → decideApproval():
       ≤ effective PM limit → SCHEDULING
       ≤ owner limit       → AWAITING_APPROVAL (PM approves on dashboard; owner notified)
       > owner limit       → ESCALATED
9. SCHEDULING → offer slots to tenant → "option 2" (rule-based fast intent, no LLM) → SCHEDULED
10. Tradie: on site / done → IN_PROGRESS → AWAITING_CONFIRMATION
11. Tenant: "all fixed, thanks" → CLOSED; owner notified with final cost; invoice checked
    (within 5 % or NZ$50 → matched, else PM review)
```

Silence at any step: the follow-up sweeper (cron every 5 min) finds due rows, emits one event
each, the handler **claims** the row before acting, chases, and after the retry policy is
exhausted, reassigns or escalates.

### A6. Inside one handler: extract → decide → compose

```
tenant message ─► LLM: structured extraction (Zod-validated) ─┐
system facts (job, property, tenancy, history) ───────────────┼─► code policy
                                                               │   (decideTriage / decideApproval / decideReply)
                                                               ▼
                                     tools via executeTool (one transaction)
                                                               ▼
                                     LLM: compose message from an explicit fact list
```

- The model never names a state, never computes money, never picks an unoffered slot or tradie.
- Composition gets **facts only**; rule: never claim something was arranged unless a fact says so.

### A7. The tool gateway — `executeTool` (`src/tools/execute.ts`)

Every tool call, from the model or from code, goes through one function:

1. **Zod validation** of input → invalid input returns a structured error the model can fix.
2. **Permission level** `read | auto | approval`. `approval` tools check for a stored
   `approvals` row with `status = approved`; they are **never exposed to the model**
   (`toAnthropicTool` throws).
3. **Idempotency**: key = `${idempotencyScope}:${tool}:${callIndex}`, scope = job version +
   triggering message/follow-up. Runs inside a **savepoint** with `withIdempotency`, so the key and
   the effect commit or roll back together; a replay returns the stored result; same key with a
   different request hash → `IDEMPOTENCY_MISMATCH`.
4. **One audit row per call** (who, what, why, input, output, outcome, trace id) into an
   append-only table (DB trigger blocks UPDATE/DELETE).

### A8. Human in the loop

- **Approval records** (table `approvals`) — survive days, multiple PMs, audits. PM clicks
  approve → `recordApprovalDecision` → approval tool runs with the PM as actor → audited.
- **Escalation package**: summary, what's done, recommended action, evidence → PM decides in ~30 s.
- **Hand-back** only to the state the job left. **Cancel** is PM-only.
- **Four tests** for "needs a human": reversibility, impact (money/legal/safety/housing),
  confidence, accountability.

### A9. Other workflows on the same platform

| Workflow | Trigger | Human boundary |
|---|---|---|
| Inspection finding → job (M8) | PM logs a finding via API | Same as maintenance |
| Portfolio Monitor (M8) | Daily cron 06:00 NZ | Rules only (≥ 3 same-trade jobs at a property in 12 months); **proposes**, PM opens |
| Variations & invoice check (M7) | Tradie message / invoice photo | New total re-run through approval policy |
| Arrears (M9) | Daily sweep, one event per case | Agent reminds and records promises; formal 14-day notice is a **fixed template**, PM approves; Tribunal / hardship = human only |
| Inbox router | Tenant with open arrears case sends an unlinked message | Routes rent vs maintenance |
| Ops analyst | Weekly | Code detects findings; model only ranks them |

"Agents are thin, the platform is thick": arrears took one state machine, five tools, a policy
function and nine eval scenarios.

### A10. Model layer (`src/agent/providers/`)

- One `LlmClient` interface; Claude default; OpenAI / DeepSeek / Kimi via an OpenAI-compatible
  adapter (JSON-schema output, or JSON mode + Zod).
- **Per-step routing** by step group: `triage, retriage, act, interpret, compose, vision, route,
  ops`. Order: eval override → org `llm_routing` → env defaults → Claude.
- **Resilience**: per-step timeouts from measured latency; fallback model; **circuit breaker**
  (3 failures in 60 s → skip 60 s, half-open trial). Fail over on timeout/429/5xx/auth/balance;
  **not** on refusals or bad answers (another model isn't a fix for content).
- **Data class per step**: `personal` steps can't go to offshore providers without safeguards
  (NZ Privacy Act IPP 12) — misconfig fails closed and the job escalates.
- Errors: refusal / unparsable output / config error → escalate immediately, never guess.

### A11. Quality loop & observability

```
PM flags a mistake ─► agent_feedback ─► pnpm eval:harvest ─► draft scenario (reviewed: false)
red team (pnpm redteam) ───────────────────────────────────┘          │ human review
                                                                       ▼
                         evals/scenarios/*.yaml ─► pnpm eval / nightly CI ─► prompt/policy/model change ─► PR
```

- Tests: Vitest unit + DB tests on real Postgres with a scripted fake LLM.
- Evals: ~84 YAML scenarios; metrics: urgency/trade accuracy, escalation precision/recall,
  final state, reply language, escalation **reason**; **forbidden actions must be 0**.
  Smoke set of 17 ≈ US$1.
- Observability: OpenTelemetry GenAI spans → Langfuse; Sentry (scrubbed); `llm_calls` (tokens,
  cache, cost in USD micro-dollars, latency); per-job "Agent trace" page; `/api/v1/health` 503
  while migrations pending.
- Cost: ~US$0.06 and ~4 calls per scenario on Claude Opus; a full job ≈ 10 calls.

---

## Part B — Knowledge points for interviews

Each item: **concept → how it shows up here → the one-liner to say.**

### B1. Agent design

| Concept | Here | Say |
|---|---|---|
| Workflow vs agent | Workflow with LLM steps; one bounded tool loop | "Fixed business processes run on a state machine; open-ended tasks on a harness." |
| Bounded autonomy | Tool loop only in TRIAGED, ≤ 8 turns, self-check after | "Autonomy is given per action, not per agent." |
| Structured output | `output_config.format` + Zod; mismatch → `LlmOutputError` → escalate | "Never parse prose; validate, and escalate on failure." |
| Hallucination control | Code computes money, state, eligibility; compose from fact list | "The model can't invent what code owns." |
| Task decomposition | ~12 states designed up front, 1–2 narrow LLM calls each | "Planning happens at design time, not run time." |
| Memory | Context rebuilt from Postgres each step (job, property, last 12 messages); no vector DB | "Memory is business state, not a chat transcript." |
| Intent funnel | Layer 1 rules (`fast-intents.ts`), layer 2 state, layer 3 model | "Cheapest correct layer first; a rule only matches the whole message." |
| Harness engineering | Narrow domain harness: gateway, routing, state machine, evals | "The environment around the model matters more than the framework." |
| Why not LangGraph / CrewAI | Checkpoint store = second source of truth; days-long waits are a durable-execution problem | "I chose durable execution + DB state over a graph framework." |
| MCP | Next step: expose `executeTool` as an MCP server | "Same permissions and audit for any external agent." |

### B2. Safety & security

| Concept | Here | Say |
|---|---|---|
| Prompt injection | `<untrusted_message>` wrapping, closing tags neutralised, `promptInjection` flag → escalate, nothing sent; also text in images | "Untrusted content is data; and the model can't reach dangerous tools anyway." |
| Least privilege | Approval tools never exposed to the model; no shell, no arbitrary HTTP | "Defense in depth: capability, data, input, outbound." |
| Multi-tenancy | `organization_id` everywhere, composite FKs, Postgres **RLS** via `SET LOCAL ROLE keyhook_app` in `withOrg()`; fails closed; a test fails if a table lacks a policy | "Isolation enforced by the database, not just WHERE clauses." |
| Audit | Append-only `audit_log`, DB trigger rejects updates | "Every agent action is explainable after the fact." |
| Privacy / residency | Data class per step; IPP 12 opt-in; Sentry scrubbing | "Routing config is validated against data class and fails closed." |
| Sandboxing | Not needed — no code execution; would use Firecracker/gVisor, no network, short-lived creds if added | "Know when you need a sandbox and when you need a tool allowlist." |

### B3. Distributed systems & reliability

| Concept | Here | Say |
|---|---|---|
| Durable execution | Inngest: events, retries, cron, `step.run` | "Work that waits for days can't live in memory." |
| Concurrency control | Inngest concurrency key = jobId (one run per job) | "Serialise per entity, parallelise across entities." |
| Idempotency | Key + request hash in same transaction as effect; savepoint; replay returns stored result | "At-least-once delivery + idempotent effects = effectively once." |
| Optimistic locking | `version` column on jobs | "Detect lost updates without holding locks." |
| Claim-before-act | Follow-up rows claimed before chasing | "A duplicate event becomes harmless." |
| DB as source of truth | Sweeper re-derives due work from `follow_ups`; event id dedupe | "If an event is lost, the next sweep recovers it." |
| Failure handling | `onFailure` → escalate; permanent vs transient errors | "Jobs never stall silently; failure becomes a human task." |
| Circuit breaker | Closed / open / half-open, per process today → Redis at scale | "Stop paying 60 s timeouts to a dead provider." |
| Transactional outbox (future) | When other services consume job events | "A commit and its event can't diverge." |
| Short transactions | Never call the LLM inside a DB transaction | "Do slow I/O first, then apply effects in one transaction." |

### B4. Data modelling

- **Money as integer cents (NZD)** — no floating-point errors; `assertCents`.
- **UTC storage, Pacific/Auckland display** — DST-safe.
- **Invariants in the DB**: CHECK constraints, composite FKs `(organization_id, id)`, enums
  generated from the same TS constants as the code.
- **Approval policy**: `effective PM limit = min(PM limit ?? org default, owner limit)` — a PM can
  never auto-approve above what the owner authorised.
- **Scaling plan**: partition `audit_log`, `messages`, `llm_calls` monthly; CDC to a warehouse;
  read replicas for the dashboard; schema/DB-per-tenant for big customers.

### B5. LLM evaluation & quality

- **Three layers**: deterministic code tests (fake LLM) → scenario evals on real models → finding
  unknowns (red team + PM corrections).
- **Check the reason, not just the outcome** (`notReasons`) — right answer for the wrong reason is
  a latent bug.
- **Human reviews generated tests** — red-team/harvested scenarios land as `reviewed: false`.
- **Models chosen by eval score × cost**, per step. Example: Kimi escalation precision 0.88 vs
  Claude 1.0 — a wrong escalation costs PM time every time, so cheap tokens can be expensive.
- **Release gate**: eval score + forbidden actions = 0 as a required check for prompt/model changes.

### B6. Cost & performance

- Rules before the model (fast intents); prompt caching on the stable prefix; cheaper model for
  `compose`/`interpret` from the same provider (only after the eval holds); effort per step;
  daily budget and simulator rate limits; per-job cost visible on the dashboard.
- The economics argument: model cost < 1 % of the value of a job; the expensive failures are
  wrong/missed escalations and slow replies to emergencies.

### B7. Architecture evolution

- Modular monolith → extract along seams in order: messaging gateway → LLM gateway → media service.
- Vercel/Neon → AWS when residency/private networking/contracts require (ECS Fargate before EKS;
  Aurora Multi-AZ; S3+KMS for media; SQS/EventBridge via outbox; Terraform; blue/green).
- HA/DR: ≥ 2 AZs, PITR, Aurora Global DB to Sydney, RPO ≤ 5 min, RTO ≤ 1 h.
- "Every move has a trigger; none is done because big companies do it."

### B8. AI-assisted delivery

- Independent PR reviewer + security reviewer agents (`review.yml`), risk tiers from changed paths,
  humans merge. Staged plan up to agents implementing issues with humans approving plan and result.

---

## Part C — Likely questions, short answers

1. **How do you stop the LLM doing something dangerous?** It can't reach it: state machine in code,
   approval tools hidden and gated by stored records, money computed in code, Zod on every input,
   injection → escalate.
2. **What happens if Inngest retries a step that already sent an SMS?** Idempotency key in the same
   transaction as the effect → replay returns the stored result, no second message.
3. **Two messages for one job arrive together?** Concurrency key = jobId serialises them; inbound
   messages are processed at most once (`DuplicateInboundError` aborts the second).
4. **The model returns garbage / refuses?** `LlmOutputError` / `LlmRefusalError` → escalate with
   the reason; never retried blindly.
5. **Provider down?** Fallback model + circuit breaker; permanent errors escalate; emergencies
   always reach a person.
6. **How do you know a prompt change didn't regress?** Scenario evals per commit, forbidden
   actions must stay 0, score diff in the PR.
7. **Why not LangGraph?** State belongs in domain tables; waits of days are durable-execution
   problems; a checkpoint store is a second source of truth.
8. **Multi-tenant isolation?** RLS with a restricted role set per transaction, plus explicit org
   filters, composite FKs, and a test that fails if a table lacks a policy.
9. **Hardest bug the evals found?** Red team: agent claimed things were arranged when they weren't;
   continued after "don't send anyone yet"; summary said "acknowledged tenant" when nothing was
   sent. Fixed with fact-list composition and kept as regression scenarios.
10. **What would you do next?** Validate tool outputs, summarise long threads, per-provider token
    bucket, shared breaker state, real channels behind the messaging adapter, MCP server for tools.

### Code pointers to memorise

| Topic | File |
|---|---|
| State machine | `src/workflows/state-machine.ts` |
| Orchestration loop | `src/agent/advance.ts` |
| Inngest function | `src/workflows/functions/job-advance.ts` |
| Tool gateway | `src/tools/execute.ts` |
| Idempotency | `src/domain/idempotency.ts` |
| Spend policy | `src/domain/approval-policy.ts` |
| Escalation rules | `src/agent/policy.ts` |
| Injection wrapping | `src/agent/untrusted.ts` |
| Fast intents | `src/agent/fast-intents.ts` |
| Failover / breaker | `src/agent/providers/resilience.ts` |
| RLS | `src/db/org-scope.ts`, migration `0007_m5_row_level_security.sql` |
| Follow-up sweeper | `src/workflows/functions/follow-ups.ts` |
