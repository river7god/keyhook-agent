English | [简体中文](README.zh-CN.md)

<h1 align="center">Keyhook-agent</h1>

<p align="center">
  <b>AI agents that run New Zealand rental maintenance from the tenant’s first message to a closed,
  invoice-checked work order, and bring in the property manager only when a person is needed.</b>
</p>

<p align="center">
  <a href="https://github.com/river7god/keyhook-agent/actions/workflows/ci.yml"><img src="https://github.com/river7god/keyhook-agent/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/Next.js-16-000000" alt="Next.js 16">
  <img src="https://img.shields.io/badge/Postgres-17%20%2B%20RLS-336791" alt="Postgres 17 with RLS">
  <img src="https://img.shields.io/badge/evals-74%20scenarios-232a59" alt="74 eval scenarios">
</p>

<p align="center">
  <a href="https://keyhook-agent.vercel.app"><b>Live demo</b></a> (login on request) ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/operations.md">Operations</a> ·
  <a href="docs/roadmap.md">Product roadmap</a> ·
  <a href="docs/development.md">Run locally</a>
</p>

<p align="center">
  <img src="docs/media/demo-flow.gif" alt="A tenant reports no hot water; the agent triages, briefs a supplier, gets a quote, sends it for approval and books the visit" width="900">
  <br><sub>A real run (local, Kimi K2.6, sped up): tenant report → triage → supplier quote → PM approval → visit booked.</sub>
</p>

> Built as a portfolio project for the **AI Product Engineer** role at Keyhook. It is an independent
> project, not affiliated with or endorsed by Keyhook. All people, properties and suppliers are
> fictional.

---

## Built for the brief

| The role asks for… | Where it shows up here |
|---|---|
| Agents that progress a maintenance issue **from start to finish** | One state machine from `RECEIVED` to `CLOSED`: triage, supplier, quote, approval, visit, variation, invoice, confirmation |
| **Escalate when a person needs to be involved** | Code-enforced rules (emergency, spend above limit, low confidence, legal, injury, injection), with a 30-second escalation package |
| **Keep going until the job is done** | Durable workflows wait days, chase silence, reassign suppliers and close the loop |
| **Check their own work**; systems that test and improve themselves | 74 eval scenarios, forbidden actions = 0, and PM corrections turned into new scenarios |
| **Real production software, not demos or chatbots** | Multi-tenant RLS, append-only audit, idempotent tools, CI, tracing, deployed on Vercel + Neon + Inngest |
| Fewer of the *four people, three systems and nine manual steps* | The PM sees only approvals and escalations; tenant, supplier and owner updates are automatic |
| Make Keyhook **increasingly capable of doing the work itself** | A shared agent platform: the next agent (arrears, enquiries, letting) is a new state machine plus evals |

## What it does

<table>
<tr>
<td width="50%"><img src="docs/media/work-orders.png" alt="Work orders dashboard"><br><b>Needs you:</b> a prompt-injection attempt and a safety finding, each escalated with the reason and a recommendation.</td>
<td width="50%"><img src="docs/media/job.png" alt="Job timeline"><br><b>Every decision on one timeline:</b> messages, triage, tool calls, approvals and AI cost.</td>
</tr>
<tr>
<td><img src="docs/media/agents.png" alt="Agent catalog"><br><b>Agent catalog</b> with live numbers, autonomy level and where a person decides.</td>
<td><img src="docs/media/portfolio.png" alt="Portfolio Monitor"><br><b>Portfolio Monitor</b> spots repeated faults and proposes a permanent fix. The PM decides.</td>
</tr>
</table>

<p align="center">
  <img src="docs/media/tour.gif" alt="Product tour: landing page, work orders, job timeline, agent catalog, portfolio monitor, audit log" width="800">
  <br><sub>Product tour: landing page → work orders → job timeline → agent catalog → Portfolio Monitor → audit log.</sub>
</p>

| Agent | Status | Does on its own | A person decides |
|---|---|---|---|
| **Maintenance** | Live | Triage, clarify, pick and brief a supplier, chase, book, confirm, close | Spend above the PM’s limit, emergencies, unclear responsibility |
| **Photo & document vision** | Live | Reads tenant photos (issue, safety cues, appliance labels) and invoice photos | What a photo can’t settle |
| **Variations & invoice check** | Live | Re-checks extra costs against PM/owner limits; matches invoices within 5 % or NZ$50 | Variations above the limit, invoice differences |
| **Inspection intake** | Live | Turns an inspection finding into a work order and tells the tenant | Vague findings |
| **Portfolio Monitor** | Live | Daily scan for repeated faults (3+ same-trade jobs in 12 months) | Whether it becomes a job |
| **Tenant & owner updates** | Live | Milestone updates in the tenant’s language; owner told about approvals and final cost | Sensitive conversations |
| Arrears · Inbox router · Enquiries & letting · Compliance · Bond · … | Next / planned | See [roadmap](docs/roadmap.md) | |

## How it stays safe

| Rule | Enforced by |
|---|---|
| **The state machine decides the next state**; the model decides only within a step | `src/workflows/state-machine.ts`; the model is never asked for a state |
| **Money needs authority** | Tools carry `read` / `auto` / `approval` permissions; approval tools refuse to run without a stored PM decision; limits computed in integer cents |
| **No duplicate side effects** | Idempotency keys per job version and triggering message; per-job workflow concurrency |
| **Tenant and supplier text is data, not instructions** | Wrapped as untrusted; injection in text *or* images → escalate, nothing sent |
| **Every action is accountable** | Append-only `audit_log` (DB trigger): who, what, why, inputs, outputs, trace id |
| **Agencies can’t see each other’s data** | `organization_id` on every row, composite FKs, Postgres row-level security (fails closed) |
| **NZ privacy** | Offshore model providers need an explicit opt-in (Privacy Act IPP 12); error reports scrubbed |

## Architecture

```mermaid
flowchart LR
  T["Tenant / supplier<br/>messages & photos"] --> API["Next.js /api/v1<br/>auth · RLS"]
  PM["PM dashboard"] --> API
  API -->|events| INN["Inngest<br/>durable workflows"]
  INN --> AG["Agent handlers<br/>one per job state"]
  AG --> LLM["Model router<br/>Claude default · OpenAI · DeepSeek · Kimi"]
  AG --> TOOLS["executeTool<br/>permissions · idempotency · audit"]
  TOOLS --> DOM["Domain layer<br/>only path to the DB"]
  DOM --> DB[("Postgres<br/>RLS · audit log")]
  TOOLS --> OUT["Messaging adapter<br/>(mock outbox in dev)"]
  AG -.-> OBS["OpenTelemetry → Langfuse · Sentry"]
```

A **modular monolith, API-first**. Each handler follows the same pattern: the model extracts,
code decides, the model composes. The tool loop runs only where it is needed. Seams for later
extraction (messaging, LLM gateway, media) are already interfaces.

| Layer | Technology | Why |
|---|---|---|
| App & API | Next.js 16 (App Router), React 19, TypeScript strict | One deployable; server components over the domain layer; `/api/v1` for integrations |
| Workflows | Inngest | Durable waits of days, retries, per-job concurrency keys, cron |
| Data | Postgres 17, Drizzle ORM, row-level security | Relational integrity, composite org keys, RLS as a second line of defence |
| Models | Anthropic SDK (structured outputs, tool use), OpenAI-compatible adapter | Claude by default; any step can be routed to another model, chosen by eval score |
| Validation | Zod on every tool input/output and model output | The model can’t smuggle in a malformed action |
| Quality | Vitest (unit + DB), in-house eval runner, PM correction harvest | Tests for code, evals for judgement |
| Observability | OpenTelemetry → Langfuse, Sentry, `llm_calls` cost table | Trace every prompt; know the cost per job |
| Hosting | Vercel (`syd1`), Neon (Sydney), Inngest Cloud | Closest regions to NZ, zero ops for a small team |

More: [business & technical architecture](docs/architecture.md) · [decisions log](docs/decisions.md) (40+ dated decisions).

## Proof, not claims

Live eval runs against real models (results in [`evals/results/`](evals/results)):

| | Claude Opus 5.5 (default) | Kimi K2.6 |
|---|---|---|
| Run | Smoke set, 15 scenarios (one per category), 2026-10-18 | Full set, 60 scenarios, 2026-10-17 |
| Passed | **15 / 15** | 54 / 60 (fixes since added as prompts + scenarios) |
| Urgency / trade accuracy | **100 % / 100 %** | 100 % / 100 % |
| Escalation precision / recall | **100 % / 100 %** | 88 % / 97 % |
| Forbidden actions (unapproved spend, unsafe messages) | **0** | 0 |
| Latency per scenario | **19.5 s** | 75 s |
| Cost per scenario | **US$0.06** (4.1 model calls) | not priced |

The smoke set is `pnpm eval:smoke`, capped at US$2; the full Claude run is about US$4.50.

| Engineering | |
|---|---|
| Automated tests | **260+**, incl. RLS isolation, concurrency, idempotency, prompt injection, the real Anthropic SDK over a fake HTTP layer |
| Eval scenarios | **74**: emergencies, vague or angry tenants, tenant damage, over-budget, silent suppliers, injection, non-English, variations, invoices, inspections |

## DevOps and automation

- **CI on every push**: format, typecheck, strict lint, 260+ tests against a real Postgres, a
  migration drift check, build. **Nightly live evals** with results per commit.
- **Self-running system**: durable workflows, follow-up sweeper, retention and monitor crons,
  failures escalate instead of failing silently, per-call cost tracking and budgets.
- **Observability**: GenAI traces in Langfuse, errors in Sentry, business audit in the dashboard,
  a health endpoint that fails while migrations are pending.
- **AI-assisted engineering under rules**: built with Claude Code, governed by
  [`CLAUDE.md`](CLAUDE.md), "done" means `pnpm check` is green plus evals for agent changes.

Next steps: automated production migrations, evals as a PR gate, dependency scanning, alerting,
Terraform. See [`docs/operations.md`](docs/operations.md).

## Scaling path

| Stage | When | What changes |
|---|---|---|
| **Now** | Portfolio / pilot | Modular monolith on Vercel + Neon + Inngest; seams in place |
| **1. Inside Keyhook** | First paying agencies | Keyhook platform adapters, real SMS/email/portal channels, autonomy per agency, evals as a release gate, partitioned tables |
| **2. AWS, high availability** | Data residency, private networking, steady load | NZ region with 3 AZs, ECS Fargate, Aurora PostgreSQL Multi-AZ, S3 media, outbox → SQS/EventBridge, LLM gateway (Anthropic + Bedrock), Terraform, DR to Sydney |
| **3. Platform & microservices** | Several agents and teams | Extract messaging gateway → LLM gateway → media service; EKS when a platform team runs it; warehouse via CDC |

Kubernetes and microservices follow team and service count, not traffic alone. Details and
triggers: [`docs/architecture.md` §3–4](docs/architecture.md#3-evolution-migrating-as-it-grows).

## Product direction

1. **Next agent: arrears (M9)**, reusing tools, approvals, audit and evals.
2. **Front door: an inbox router** that classifies every message and routes it to the right agent.
3. **Letting**: facts-only enquiry answers 24/7, viewing bookings, listing copy per channel (Trade
   Me, realestate.co.nz, OneRoof, social), with an anti-discrimination check and PM approval.
4. **Before real customers**: mobile approvals, real channels, a supplier link portal, owner
   approvals in their portal, a policy settings UI and an ROI dashboard.

Full analysis, prioritisation and open product questions: [`docs/roadmap.md`](docs/roadmap.md).

## Documentation

| | |
|---|---|
| [Product spec](docs/spec.md) | State machine, urgency and escalation policy, tools, evals, milestones |
| [Architecture](docs/architecture.md) | Business and technical architecture; AWS / HA / Kubernetes path |
| [Operations](docs/operations.md) | CI/CD, observability, runtime automation, SLOs |
| [Roadmap](docs/roadmap.md) | Agents across the tenancy lifecycle; letting & listing exposure; product gaps |
| [Agent catalog](docs/agents.md) | Human/agent boundaries |
| [Keyhook fit](docs/keyhook-fit.md) | How this maps onto Keyhook’s platform |
| [Decisions](docs/decisions.md) | Architecture decisions with reasons |
| [Development](docs/development.md) | Run locally, choose a model, tests and evals |
| [Deploy](docs/deploy.md) | Vercel + Neon + Inngest Cloud |

Every document has a Simplified Chinese version alongside it (`*.zh-CN.md`); English is canonical.
