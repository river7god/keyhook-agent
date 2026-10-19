English | [简体中文](agent-design.zh-CN.md)

# Building production agents: problems and how this project solves them (2026-10-18)

A field guide to the hard parts of putting LLM agents into production, and the choice made for
each one here. It is written for reviewers and future contributors. The system shape is in
[`architecture.md`](architecture.md); individual decisions are in [`decisions.md`](decisions.md).

**In one sentence:** this is a *transactional* agent system (money, legal notices, people's
homes), so the design puts reliability and safety in code — a state machine, durable workflows
and a tool gateway — and confines the model to understanding and writing.

---

## 1. Workflow or agent? Where the model is allowed to decide

The most important design choice in any agent is **who decides what happens next**.

| Pattern | The model decides | Good for | Risk |
|---|---|---|---|
| Workflow with LLM steps | Within a step (classify, extract, write) | Known business processes | Low: every path is in code |
| Bounded tool loop | Which tool, from a short list, a few times | Choosing among options the system offers | Medium: needs limits and a self-check |
| Autonomous agent / planner | The plan and the next step | Open-ended research, coding | High: hard to test, audit and bound |

**Rule used here: the model extracts and writes; code decides.** Each handler follows
*extract → code decides → compose* (decisions.md 2026-10-17):

```
tenant message ──► LLM: structured extraction (urgency, trade, flags)  ─┐
                                                                         ├─► code: policy (decideTriage, decideApproval,
system facts ───────────────────────────────────────────────────────────┘          decideReply) ─► tools via executeTool
                                                    LLM: compose the message ◄────┘
```

Put it in **code** when any of these is true (the four tests in [`agents.md`](agents.md) §5):

- **irreversible**: a legal notice, a payment;
- **high impact**: money, safety, tenancy;
- **checkable**: a spend limit, a date rule;
- **someone is accountable** for it: the PM or the owner.

Let the **model** do it when the input is unstructured (messages, photos, invoices), when the output is for a person to read, or when the choice is
among system-provided options whose result is validated.

| In this project | Who decides |
|---|---|
| Next job/case state | Code: `src/workflows/state-machine.ts`, `arrears-state-machine.ts` |
| Spend: auto / PM / escalate | Code: `src/domain/approval-policy.ts` (integer cents) |
| Escalation rules | Code: `src/agent/policy.ts` |
| Arrears: promise or plan acceptable? | Code: `decideReply` in `src/agent/arrears/advance.ts` |
| 14-day notice wording | Code: fixed template (`noticeText`), never model-written |
| What the tenant said, what the photo shows | Model: structured output, Zod-validated |
| Which eligible tradie to brief | Model, in the **only** tool loop (TRIAGED): ≤ 8 turns, then a self-check that the state really moved |
| Wording of messages | Model, from given facts only |

## 2. State, durability and long-running work

**Problem:** real work waits for hours or days (a tradie's quote, a tenant's reply). A process
holding state in memory, or a chat transcript, doesn't survive restarts, retries or deploys.

**Approaches:** framework checkpoints (LangGraph's checkpointer), durable execution engines
(Temporal, Inngest, AWS Step Functions), or state in your own database plus a scheduler.

**Here:**

- **State lives in the business tables** (`jobs`, `arrears_cases`): the dashboard, the audit log
  and the agent all read the same thing. There is one source of truth, not a checkpoint blob
  beside the data.
- **Inngest** runs the workflows (`src/workflows/functions/`):
  - events trigger each step;
  - per-job and per-case concurrency is 1, so two runs never advance the same thing at once;
  - retries are automatic, and `onFailure` escalates to a PM instead of failing silently;
  - cron sweeps handle follow-ups (every 5 minutes), arrears (daily), the Portfolio Monitor
    and data retention.
- **Follow-ups are rows** (`follow_ups`): swept, *claimed before acting*, and cancelled when the
  awaited reply arrives.
- **Task decomposition happens at design time.** A job's life is split into ~12 states and an
  arrears case into 8. Each step makes one or two model calls with a narrow purpose. Runtime
  planning is used only where the task is open-ended (the red-team generator).

## 3. Tool use and function calling

**Problems:**

- the model calls the wrong tool or invents arguments;
- a retry repeats a side effect (two SMS, two bookings);
- a tool can do more than the model should be allowed to;
- nothing records why an action happened.

**Here, a single gateway runs every tool call:** `executeTool` (`src/tools/execute.ts`), whether
the caller is the model or workflow code. It applies:

1. **Typed input**: a Zod schema per tool, converted to JSON Schema for the model. Invalid input
   gets a structured error the model can correct.
2. **Permission levels** `read | auto | approval` (CLAUDE.md rule 2). An `approval` tool runs
   only if a stored PM approval record exists for that job or case, and it is **never exposed
   to the model** (`toAnthropicTool` throws).
3. **Idempotency**: the key is the job version plus the triggering message, follow-up or
   approval. The tool runs inside a savepoint with the key, so a failed call rolls both back.
4. **One audit row per call**: who, what, why, inputs, outputs, outcome and trace id, in an
   append-only table (a DB trigger rejects updates).

Outside the one tool loop, the model returns **structured output** (`output_config.format`,
validated by Zod) and code calls the tools. That is more predictable than letting the model call
tools freely. The same tool definitions work with Claude, OpenAI, DeepSeek and Kimi
(`src/agent/providers/`).

## 4. Human-in-the-loop

**Problem:** "ask a human" has to survive days, multiple people and audits, and the agent must
not be able to skip it.

**Here:**

- **Approval records**: an approval lives in the `approvals` table (quotes, variations, arrears
  notices). PM decides on the dashboard → `recordApprovalDecision` → the approval-level tool
  runs with the PM as actor → audited.
- **Escalation is a product surface**, not "please call someone". Every escalation carries a
  summary, what has been done, a recommendation and evidence, so a PM can decide in about
  30 seconds.
- **Hand-back**: the PM can return a job to the agent, but only to the state it left.
- **The boundary between agent and person is explicit per action** ([`agents.md`](agents.md)
  §5.2). The roadmap makes autonomy a per-agency setting: suggest → approve → act.
- **The human checks the AI's tests too**: red-team findings and PM corrections land as
  `reviewed: false` scenarios until a person accepts them.

Framework alternative: LangGraph's `interrupt()` pauses a graph run until resumed. Approval
*records* were chosen because approvals here span days, need multiple PMs and must be audited.

## 5. Untrusted input and prompt injection

**Problem:** tenants and suppliers can write anything — including instructions to the agent, in
text or inside an image.

**Here** (CLAUDE.md rule 5):

- All inbound text is wrapped as `<untrusted_message>`, closing tags are neutralised, and the
  system prompt says it is data (`src/agent/untrusted.ts`).
- Extraction schemas include a `promptInjection` flag. When it is set, the job escalates and
  **nothing is sent**. The same applies to text inside photos (vision step) and to arrears replies.
- The model cannot reach dangerous capability anyway. Approval tools aren't exposed; the policy
  is computed in code; tool inputs are validated.
- Tested by eval scenarios (hidden limits, role-play, injection in a quote or a variation), and
  probed continuously by the red team.

## 6. Isolation and sandboxing

**When you need a sandbox:** an agent that executes generated code or browses arbitrary sites
(coding agents, data-analysis agents, deep-research agents) must run that code in an isolated,
disposable environment:

- Docker, gVisor or Firecracker microVMs, or a hosted sandbox;
- no network by default;
- read-only, short-lived credentials;
- CPU, memory and time limits;
- output treated as untrusted.

**Here, no agent executes code.** The agents can only call a fixed, typed allowlist of tools. So
isolation is enforced at other layers:

| Layer | Control |
|---|---|
| Capability | Tool allowlist with schemas and permission levels; no shell, no arbitrary HTTP |
| Data | `organization_id` on every row, composite FKs, Postgres row-level security via a dedicated role that fails closed |
| Input | Untrusted wrapping; injection flags escalate |
| Outbound | Messages go through an adapter (mock outbox in development, rule 7) |
| Privacy | Offshore model providers need an explicit opt-in (NZ Privacy Act IPP 12); errors scrubbed before Sentry |

**When this changes:** the roadmap's engineering agents (run tests, propose fixes) would execute
code. Those agents must run in ephemeral containers with no production credentials, and their
changes go through PR review.

## 7. Output reliability

| Problem | Control here |
|---|---|
| Malformed or partial output | Structured outputs plus Zod validation. A mismatch raises `LlmOutputError` and the job escalates |
| Refusals | Detected (`stop_reason: refusal`) and escalated, never retried blindly |
| Provider outage, bad key, no balance | Permanent errors (auth, billing) escalate immediately; transient ones retry with backoff |
| Hallucinated facts in messages | Composition gets an explicit fact list. Rule: never claim something was arranged unless a fact says so (added after the red team caught it) |
| Wrong reason for the right outcome | Eval `notReasons` checks the escalation reason, not just the outcome |
| SDK surprises | Tests run the real SDK over a fake HTTP layer (this caught a `withResponse` mismatch the types hid) |

## 8. Evaluation: proving it works, and keeping it working

**Problem:** prompts and models change; quality silently drifts; demos only show the happy path.

Three layers, each catching what the others miss:

1. **Code tests** (290+, Vitest, many against a real Postgres): the state machines, policies,
   RLS isolation, concurrency, idempotency, injection handling, and a scripted model for
   deterministic flows.
2. **Scenario evals** (83 YAML scenarios, `pnpm eval`): run multi-step conversations against a
   real model and score urgency, trade, escalation precision and recall, final state, required
   actions, reply language and the escalation reason. **Forbidden actions must be 0.** Results
   are stored per commit and model. A spend cap and a 17-scenario smoke set (`eval:smoke`,
   ≈ US$1) keep it cheap.
3. **Finding unknown failures**:
   - the **red team** (`pnpm redteam`): a model writes adversarial cases, the real agent runs
     them, rules plus a judge (who also sees the system's tool results) score them;
   - **PM corrections** (`pnpm eval:harvest`).

   Both become *draft* scenarios that a person reviews.

The improvement loop:

```
production / red team ─► draft scenario ─► human review ─► eval suite ─► prompt / policy / model change ─► CI + eval
```

Example from this project: the red team's second run found three real problems:
- the agent claimed things had been arranged when they hadn't;
- it continued a job after the tenant said "don't send anyone yet";
- its escalation summary said "acknowledged the tenant" when nothing had been sent.

Each was fixed and kept as a regression scenario.

## 9. Observability and cost

- **Traces**: one OpenTelemetry GenAI span per model call (model, tokens, latency, step),
  exported to Langfuse; workflow spans per job.
- **Errors**: Sentry, server-side, with personal data scrubbed.
- **Business audit**: append-only `audit_log`, visible to PMs per job and case.
- **Cost**: every call is recorded in `llm_calls` (USD micro-dollars, cache tokens included).
  Per-job cost shows in the dashboard. There is a daily budget and simulator rate limits, and
  each step group can use a different model (e.g. a cheaper model for writing messages). Measured:
  US$0.06 and 19.5 s per scenario on Claude Opus 5.5.
- **Health**: `/api/v1/health` fails while migrations are pending.

## 10. Multi-tenancy and data

- Every table that has `organization_id` has an RLS policy; a test fails if one is missing.
- Request-scoped access runs under `withOrg()` as a restricted role; workers use the owner role
  deliberately and always filter by organization.
- Media is stored with a retention period (180 days, daily purge); money is integer cents NZD;
  times are stored in UTC and displayed in Pacific/Auckland.

## 11. Model choice and portability

- One `LlmClient` interface. Claude is the default, and OpenAI-compatible providers go through
  an adapter.
- Routing per agency and per step group (`triage`, `act`, `interpret`, `compose`, `vision`).
- **Models are chosen by eval score and cost, not preference.** Today's comparison: Claude Opus
  5.5 smoke 15/15 at US$0.06/scenario; Kimi K2.6 full set 54/60 before fixes.

## 12. Frameworks: LangGraph, DeerFlow and others — why not here

| Option | What it gives | Fit for this project |
|---|---|---|
| **LangGraph** | Graph-based orchestration, checkpointed state, `interrupt()` for human input, streaming, LangSmith tracing/evals | Not used. The flows are fixed business processes; state belongs in the domain tables; days-long waits, timers and retries are durable-execution problems (Inngest). A checkpoint store would be a second source of truth. Migration seam: any graph node could call `executeTool`, keeping audit, permissions and idempotency |
| **DeerFlow** (ByteDance) | Multi-agent deep-research framework on LangGraph: planner, researchers, coder, reporter; web search and code execution | Wrong shape. It is built for open-ended research and report generation; this is a transactional system where model-led planning and code execution are risks to avoid. Could power a *research* feature (rent comparables, complaint trends) that only advises |
| OpenAI Agents SDK, Claude Agent SDK, CrewAI, AutoGen, Mastra, Pydantic AI | Agent loops, handoffs, tool registries | Same trade-off; the thin loop here is a few dozen lines and fully under our control |
| Temporal, Step Functions | Durable execution | Equivalent to Inngest; a candidate if self-hosting is required ([`architecture.md`](architecture.md) §4) |
| MCP | A standard way to expose tools to any agent | A good next step: expose the tool gateway as an MCP server so other agents (or Keyhook's) can use it with the same permissions and audit |

**When a framework would be worth it:**
- many agents whose collaboration is decided at run time;
- a team standard on that ecosystem;
- a need for graph-level replay and debugging.

The guardrails would stay in this codebase either way: the state machine's authority, approval
records, idempotency, audit and RLS.

## 13. Checklist for the next agent

A new agent on this platform is "done" when it has:

- [ ] a state machine in code, with terminal states and a PM-only path out of escalation;
- [ ] tools through `executeTool`: Zod schemas, a permission level, idempotency keys, and
      approval tools for anything irreversible;
- [ ] handlers that extract → decide in code → compose, with untrusted input wrapped and
      injection escalated;
- [ ] escalation packages with summary, what's done, recommendation and evidence;
- [ ] durable triggers (events, cron) with per-subject concurrency;
- [ ] RLS on any new table, and org-scoped queries;
- [ ] DB tests with a scripted model, eval scenarios (including injection and "should
      escalate"), and a red-team focus category;
- [ ] a decision record (en + zh) and an entry in the agent catalog.

Arrears (M9) was built against exactly this list. It took one state machine, five tools, a
policy function and nine scenarios.

## 14. Production agent concerns: what is covered and what is not

A common checklist for production agents, answered for this codebase. ✅ = built and tested,
◐ = partly, ✗ = not yet (with the planned answer).

| Concern | Status | How |
|---|---|---|
| **Task planning / sub-tasks** | ✅ | No free-form planner. The state machine is the plan: each state is a sub-task with a handler, and the model decides only inside a step (§1). A report with several issues for different trades escalates so the PM can split it. Cross-agent hand-off goes through the inbox router. |
| **Tool inputs and outputs** | ◐ | Inputs: Zod schema per tool, checked in `executeTool` before anything runs; permission level; idempotency key; audit row. Outputs are typed in code but not schema-validated on the way back to the model. Gap: validate outputs too. |
| **Parameter bounds** | ✅ | Money is integer cents with limits from policy; slot ids must be ones offered; tradie ids must come from `search_tradies`; approval tools refuse without a stored approval. |
| **Tool concurrency and call frequency** | ✅ | One run per job / arrears case at a time (Inngest concurrency key); at most 8 tool turns per act step; idempotency makes retries safe. |
| **Memory** | ◐ | Short-term: the job's context is rebuilt from Postgres for every step (job, property, tenant, last 12 messages, past jobs at the property). Long-term: the database itself (job history, Portfolio Monitor findings, PM corrections). No vector memory — nothing here needs semantic recall. Gap: summarise long threads instead of keeping the last 12 messages. |
| **Hallucination fallback** | ✅ | The model extracts; code decides (§1). Structured output is schema-checked; amounts are parsed by code; the model cannot invent a state, supplier or slot. Unusable output → escalate. |
| **Timeouts** | ✅ | Per-step request timeout set from measured latency (`src/agent/timeouts.ts`), one SDK retry, then Inngest retries the step durably. |
| **Rate limiting** | ◐ | Simulator: messages per hour and a daily LLM budget per organization; guest login: 20 per IP per hour. Gap: a per-provider token bucket, so a burst of jobs queues instead of getting 429s. |
| **Degradation / failover** | ✅ | `LLM_FALLBACK_MODEL` plus a circuit breaker per model (3 failures in 60 s → skip for 60 s). Permanent errors (auth, balance) escalate to the PM with the reason instead of failing silently. Breaker state is per process; the shared-store version is on the roadmap. |
| **Full call logging** | ✅ | `llm_calls` (step, model, tokens in/out/cached, cost, latency, stop reason, error) and `audit_log` (every tool call, transition and rule decision) per job, shown on the job page as the "Agent trace"; OpenTelemetry spans to Langfuse. |
| **Cost and token saving** | ✅ | Rules before the model (below); prompt caching on the stable prefix (cache hits are visible in the trace); per-step routing so cheap models do simple steps; effort set per step; daily budget. |
| **Intent funnel** | ◐ | Layer 1, rules: fixed short replies (slot choice, plain confirmation) never reach the model. Layer 2, state: the job's state already says what a reply can mean, so there is no open-ended intent classification — the inbox router (rent or maintenance?) only runs when a tenant with an open arrears case sends a message that is not already tied to a job. Layer 3, the model, handles everything else. Gap: more layer-1 rules only where eval data shows they are safe. |
