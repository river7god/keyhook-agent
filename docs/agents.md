English | [简体中文](agents.zh-CN.md)

# Keyhook-agent — Agent Catalog & Human/Agent Boundaries (v0.1)

Companion to [`spec.md`](spec.md). The spec defines the maintenance agent in detail; this document
places it in the wider set of agents an AI-native property management platform needs, and defines
where agents stop and people start.

> Status: product analysis. Rows marked **(proposed)** are not yet confirmed business rules — confirm
> before implementing. NZ regulatory details must be verified against Tenancy Services and the
> Residential Tenancies Act before they are relied on. This is product policy, not legal advice.

## 1. What the role is really asking for

| Signal in the role description | What it means for the product |
|---|---|
| "so our customers can focus on adding tremendous value to landlords and tenants" | Customers are property managers (PMs). The goal is to remove PM toil, **not to replace PMs**. |
| "Escalate when a person needs to be involved" | Bounded autonomy is a stated requirement, not full automation. |
| "Keep going until the job is done" | The value is in closing loops: follow-ups, chasing, confirmation, close-out — the steps people drop. |
| "real production software; not demos, chatbots" | Reliability, evals, audit trails and security are the bar. |
| "Make Keyhook increasingly capable of doing the work itself" | Two layers: the product does customers' work, **and** the company's own engineering is automated (testing, security, dev tools). |
| "four people, three systems and nine manual steps" | Value is measured in people, system switches and manual steps removed. |
| Reports to the CEO; three hires | Company-level strategy, not a side experiment. |

**Business logic.** A PM agency's main cost is people. If one PM can handle 200–300 properties
instead of ~100, the product sells "fewer hires", not seats. The aim is to remove human *labour* per
unit of work, not humans: the PM's role shifts from executor to supervisor, exception handler and
relationship owner.

## 2. Industry needs (NZ residential property management)

Lifecycle of one property per tenancy:

```
Letting → Applications/screening → Agreement/bond → Ingoing inspection
→ Ongoing (rent, maintenance, inspections, communication)
→ Renewal/rent review → Outgoing inspection → Bond refund/dispute → Re-letting
```

Pain points:
1. **High volume, repetitive work** — messages, reminders, chasing, scheduling. Most of a PM's day.
2. **Hard compliance deadlines** — e.g. bond lodgement with Tenancy Services, written notice before
   entry/inspection, notice periods and frequency limits on rent increases, Healthy Homes Standards.
   Missing them risks fines or the Tenancy Tribunal. *(Exact days and rules: verify before use.)*
3. **Multi-party coordination** — tenant, owner, tradie and PM relaying messages between each other.

## 3. How agents are classified

**3.1 Textbook (Russell & Norvig)** — by sophistication: simple reflex, model-based reflex,
goal-based, utility-based, learning. A useful theory frame, not a product frame.

**3.2 Workflow vs agent (engineering view)**
- *Workflow*: steps defined in code; the LLM makes a judgement inside a step (classify, extract, draft).
- *Agent*: the LLM decides the next step and which tool to call.
- Most production "agents" should be workflows with local LLM decisions. Keyhook-agent follows this:
  the state machine owns the flow, the LLM decides within a step (CLAUDE.md rule 1). More autonomy =
  harder to test and audit.

**3.3 Roles in a multi-agent system** — router, orchestrator, specialist worker, critic/verifier.

**3.4 Product classification used in this project: trigger × autonomy**

| Trigger \ Autonomy | Suggest only | Act with approval | Act autonomously |
|---|---|---|---|
| **Reactive** (event: a message arrives) | | | |
| **Proactive** (schedule: scan for issues) | | | |
| **Human-invoked** (PM asks: "draft the report") | | | |

Each agent is placed in this grid, then refined **per action**: within one agent, "send a message" can
be autonomous while "spend money" needs approval. This is the origin of the tool permission levels
`read | auto | approval` (spec §8).

## 4. Agent catalog

### 4.1 Customer-facing (product)

| Agent | Trigger | Responsibility | Named in role? | Project status |
|---|---|---|---|---|
| **Inbox / Router** | Reactive | Classify every inbound message; route to the right agent or a PM | Implied | Later |
| **Maintenance** | Reactive | Request → triage → tradie → quote → approval → schedule → confirm → close | ✅ | **v1 (spec)** |
| **Arrears** | Reactive + proactive | Late-rent reminders, payment plans, draft formal notices | ✅ | **Done (M9)** |
| **Applications** | Reactive | Collect and verify documents, build comparison summaries | ✅ | Out of scope |
| **Inspections** | Proactive | Schedule, send statutory notices, draft report from photos/notes, raise follow-up jobs | ✅ | Out of scope |
| **Tenancy lifecycle** | Proactive | Renewals, rent reviews, bond lodgement, exit process | ✅ | Out of scope |
| **Portfolio Monitor** | Proactive | Detect repeated faults, compliance gaps, upcoming deadlines | ✅ ("before the PM knows") | **Done (M8)**: repeated faults; compliance checks need a data source |
| **Owner Comms / Reporting** | Human-invoked + scheduled | Monthly reports, approval requests, cost explanations | Implied | Later |

### 4.2 Internal (engineering)

| Agent | Responsibility | Named in role? |
|---|---|---|
| **QA / exploratory testing** | Find bugs before customers do — **done: `pnpm redteam`** | ✅ |
| **Security & performance testing** | Scheduled scans, load tests, regression comparison | ✅ |
| **Incident investigator** | From errors/logs, locate the cause; propose or open a fix | ✅ |
| **Developer tooling** | Code review, migrations, docs | ✅ |

In this project, the eval suite (spec §10) and CI are the internal-engineering showcase.

### 4.3 The shared platform is the real asset

All agents sit on the same infrastructure: tools with permission levels, the state machine, approval
records, audit log, idempotency, evals and escalation. **Agents are thin; the platform is thick.**
The cost of the 2nd and 3rd agent depends on platform reuse — which is why spec §4 lists arrears as
"a second workflow reusing the same tools/eval infrastructure".

## 5. Human/agent boundaries

### 5.1 Four tests

1. **Reversibility** — a wrong reminder can be corrected; a wrong termination notice cannot.
2. **Impact** — money, legal consequences, physical safety, housing stability → more caution.
3. **Confidence** — missing information, novel situations or low model confidence → a person.
4. **Accountability** — legal responsibility sits with the owner/PM; an agent cannot carry it.

### 5.2 Autonomy matrix

| Domain | Agent acts autonomously | Agent prepares, person approves | Person only |
|---|---|---|---|
| Maintenance | Triage, clarifying questions, find tradie, request quote, schedule, chase, confirm completion | Spend above the effective PM limit; unclear responsibility (possible tenant-caused damage) | On-site emergency decisions (agent notifies immediately); conversations with an injured or angry tenant |
| Arrears **(implemented M9; thresholds proposed)** | Friendly reminders, record promises to pay, track payment plans | Formal notices (agent drafts) | Applying to the Tenancy Tribunal; hardship and family-violence situations |
| Applications **(proposed)** | Collect documents, check completeness, build comparisons | Shortlist | **Final tenant selection** — Human Rights Act (anti-discrimination) and Privacy Act risk; the model never decides |
| Inspections **(proposed)** | Schedule, send notices, draft report, raise maintenance jobs | Final report sent to owner | Findings of tenant fault; bond deductions |
| Tenancy lifecycle **(proposed)** | Expiry reminders, bond lodgement, document preparation | Rent increase amount; renewal terms | Ending a tenancy; bond disputes |
| Portfolio monitoring **(proposed)** | Detect issues, generate recommendations | Whether to open a job | Major capital recommendations (e.g. replace a whole system) |
| Engineering | Run tests, write investigation reports, open PRs | Merging PRs | Final sign-off on production changes |

The maintenance row matches spec §5–§8 and the approval policy in `decisions.md`
(auto ≤ effective PM limit; PM approval ≤ owner limit; escalate above).

### 5.3 Escalation is a product surface

An escalation is never just "please contact a person". It always carries: summary, what has been
done, recommended next action, links to evidence (spec §7). Target: a PM decides in ~30 seconds
instead of re-investigating for 10 minutes.

## 6. Implications for this project

1. **Go deep on maintenance** — it is exactly the "four people, three systems, nine steps" case.
2. **Add one small proactive agent** — Portfolio Monitor detecting the three hot-water faults at the
   Newtown seed property and proposing replacement. Low cost; answers "before the PM knows" directly.
3. **Treat evals as a headline feature** — they are "check their own work" and "systems that test,
   monitor and improve themselves", and what separates production from demo.
4. **Demo narrative (2 minutes)** — one tenant message → agent runs the job → over-limit spend
   escalates to PM → one-click approval → loop closes → show audit log and eval scores.
5. **Fill the gaps next to Keyhook's existing platform** (2026-10-18, `docs/keyhook-fit.md`) — tenant
   media analysis, quote variations, invoice check, inspection findings → work orders, owner and
   tenant milestone updates, Portfolio Monitor, arrears (spec §12, milestones M6–M9). Listings,
   screening, e-signing and accounting stay with the Keyhook platform.
