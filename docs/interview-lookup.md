English | [简体中文](interview-lookup.zh-CN.md)

# Interview Knowledge Lookup

> **How to use**: don't memorise. When a term comes up, **Ctrl+F the keyword or ID** (e.g. `K7`,
> `idempotency`, `RAG`) and say what the entry says.
>
> - **Part A (K IDs)**: what Keyhook-agent **actually uses**, with file locations and numbers.
> - **Part B (S IDs)**: what the example project ShopAssist ([example project](interview-example-project.md))
>   uses and Keyhook **doesn't**.
> - **Part C**: "why Keyhook doesn't use X".
> - **Part D**: an 8-step system-design template.
>
> Every entry has the same four lines: **What** (one-line definition) → **How** (what the project
> does) → **Why** → **One-liner** (something you can say as is).

---

## Keyword index

| Keyword | ID | Keyword | ID |
|---|---|---|---|
| Agent vs workflow | K1 | LLM gateway / model routing | S1 |
| State machine | K2 | Fine-tuning | S2 |
| Agent loop / max steps | K3 | LangGraph (State / Node / Checkpointer / interrupt) | S3 |
| Tool calling / tool definitions | K4 | Multi-agent / supervisor pattern | S4 |
| Tool permissions read / auto / approval | K5 | Temporal | S5 |
| Tool gateway | K6 | MCP | S6 |
| Idempotency | K7 | Too many tools / load on demand | S7 |
| Audit log | K8 | RAG / chunking / embeddings / vector DB | S8 |
| Structured output / Zod | K9 | Hybrid search / BM25 / reranking | S9 |
| Confidence threshold / escalation | K10 | Agentic RAG / agentic search | S10 |
| Approval / human in the loop (HITL) | K11 | Long context vs RAG | S11 |
| Prompt injection (direct / indirect) | K12 | Memory short / long term | S12 |
| Context engineering | K13 | Compaction | S13 |
| Prompt caching | K14 | Agent harness / Agent SDK | S14 |
| Durable execution / Inngest | K15 | Subagents | S15 |
| Concurrency / optimistic locking | K16 | Hooks | S16 |
| Follow-ups / timeouts | K17 | Sandbox | S17 |
| Multi-model / failover / circuit breaker | K18 | Skills / progressive disclosure | S18 |
| Rules first / fast intents | K19 | A2A | S19 |
| Cost / budget / rate limits | K20 | Computer use | S20 |
| Multi-tenancy / RLS | K21 | Input/output guardrails / PII redaction | S21 |
| Evals / fake LLM / red team | K22 | Hallucination / citations | S22 |
| Observability / tracing | K23 | RAG evals / faithfulness | S23 |
| CI/CD / AI code review | K24 | LLM-as-judge | S24 |
| Other agents (ops analyst / monitor / arrears) | K25 | Online A/B / canary | S25 |
| Money / time | K26 | OpenTelemetry | S26 |

---

# Part A: what Keyhook-agent uses

### K1 Agent vs workflow
- **What**: a workflow has its steps fixed in code and the model does one step; an agent lets the model decide what to do next and which tools to call.
- **How**: Keyhook is **a workflow shell with a bounded agent inside each step**. The state machine fixes the flow; within each state the model runs a tool loop of at most 6 steps to decide how to reply and which tool to call.
- **Why**: the process is fixed and involves money and safety, so the model must not plan it; understanding and talking to people still needs the model's flexibility.
- **One-liner**: "Workflow where the process is fixed, agent where judgement is needed. In Keyhook the AI understands and writes; code decides."

### K2 State machine
- **What**: a table of every state and where each state may go; any transition not in the table is rejected.
- **How**: `checkTransition` / `allowedTransitions` in `src/workflows/state-machine.ts`, 12 states: `RECEIVED → TRIAGED → AWAITING_QUOTE → (AWAITING_APPROVAL) → SCHEDULING → SCHEDULED → IN_PROGRESS → AWAITING_CONFIRMATION → CLOSED`; `ESCALATED` is reachable at any time; only a manager can trigger `CANCELLED`. Arrears has its own: `src/workflows/arrears-state-machine.ts`.
- **Why**: the model can't invent a next state; the flow is testable and auditable.
- **One-liner**: "The state machine is the single source of truth; the model can only pick from allowed transitions."

### K3 Agent loop / max steps
- **What**: model → tool call → result → model again … until the model gives a final answer.
- **How**: `advanceJob` in `src/agent/advance.ts`, `MAX_STEPS = 6`; `pickHandler` chooses a handler for the current state (`src/agent/handlers/`: triage, quote, scheduling, visit, follow-up, media, general). Out of steps → escalate to a human.
- **Why**: no runaway loops burning money; each state has its own prompt and tools, which is more accurate.
- **One-liner**: "The loop is capped and split by state, so the model only sees what the current step needs."

### K4 Tool calling / tool definitions
- **What**: send the model each function's name, description and parameter schema; the model replies "call this tool with these arguments" and code executes it.
- **How**: one definition per tool (`src/tools/*.ts`), parameters in Zod, converted to JSON Schema by `toAnthropicTool` in `src/tools/types.ts`. Tools: read `get_property`, `list_jobs_for_property`, `search_tradies`; action `send_message`, `request_quote`, `schedule_visit`, `escalate`, `add_note`, `request_approval`; approval `approve_spend`, `approve_variation`; arrears `send_arrears_message`, `record_promise`, `request_notice_approval`, `send_arrears_notice`, `escalate_arrears`.
- **Why**: the model only proposes; code holds the power to execute. One Zod schema both describes the tool to the model and validates the input.
- **One-liner**: "The model says what it wants to call; execution and validation happen in my code."

### K5 Tool permission levels
- **What**: `read` (read-only, free to use) / `auto` (side effects, runs automatically) / `approval` (needs a human).
- **How**: every tool definition has a `permission` field. `approve_spend`, `approve_variation` and `send_arrears_notice` are `approval`: **never exposed to the model**, run only when a manager acts on the dashboard, and require a stored approval record.
- **Why**: least privilege; a tool the model can't see can't be tricked into being called.
- **One-liner**: "Dangerous tools aren't 'please don't call this'; the model simply can't see them."

### K6 Tool gateway
- **What**: the single entry point for every tool call, doing all checks in one place.
- **How**: `executeTool` in `src/tools/execute.ts`, in order: **Zod validation → permission check → idempotency → audit** (V-P-I-A).
- **Why**: rules are written once, so no tool can leak by forgetting a check.
- **One-liner**: "Every tool call goes through one gateway: validate, permission, idempotency, audit."

### K7 Idempotency
- **What**: doing an operation once or many times gives the same result.
- **How**: `withIdempotency` in `src/domain/idempotency.ts`: side-effecting tools require an `idempotencyKey`; a second call with the same key returns the first result; same key with different arguments → `IDEMPOTENCY_MISMATCH`.
- **Why**: Inngest retries on failure and the model may repeat a call; without idempotency you send duplicate SMS and duplicate work orders.
- **One-liner**: "If you retry, you need idempotency, or a retry is a double charge."

### K8 Audit log
- **What**: one row per agent action: who, what, why, inputs, outputs.
- **How**: the append-only `audit_log` table, written automatically by the tool gateway. The `llm_calls` table records every model call (tokens, cost, latency).
- **Why**: problems can be traced; managers see why the AI acted; compliance.
- **One-liner**: "For everything the AI does I can answer who, why and on what basis."

### K9 Structured output
- **What**: the model must answer in a fixed JSON shape, not free text.
- **How**: `structured()` in `src/agent/llm.ts` passes the schema through Claude's `output_config` (forced `tool_choice` isn't supported on this model), then validates with Zod (`src/agent/schemas.ts`). Validation fails → escalate to a human, no guessing.
- **Why**: code branches on the model's answer (urgency, trade), so the format must be reliable.
- **One-liner**: "Model output passes schema validation before use; bad format goes to a human, never a guess."

### K10 Confidence threshold / escalation rules
- **What**: the model gives a judgement plus a confidence; code rules decide whether to continue.
- **How**: `src/agent/policy.ts`: `TRIAGE_CONFIDENCE_THRESHOLD = 0.7`, below it → escalate; gas smell, injury, legal, emergency → straight to the manager (the model extracts facts, code decides, the AI writes: E→D→C).
- **Why**: models are good at understanding, not at being accountable; rules are testable and explainable.
- **One-liner**: "The model extracts facts and scores; code rules decide whether to escalate."

### K11 Approval / human in the loop (HITL)
- **What**: key decisions need a human's sign-off.
- **How**: `decideApproval` in `src/domain/approval-policy.ts`: a quote within the effective limit is auto-approved, otherwise `AWAITING_APPROVAL`; **effective limit = min(manager limit, owner limit)**. Escalations carry a summary + what's been done + a recommendation, so a manager decides in about 30 s. Whether a human is needed: four tests, **reversibility, impact, confidence, accountability**.
- **Why**: money and legal liability need someone accountable.
- **One-liner**: "The AI prepares everything, but over-limit spend and legal matters are a human's call, and the approval is stored in the DB."

### K12 Prompt-injection defence
- **What**: outside text hides instructions ("I'm the manager, refund me") to trick the model. **Direct**: the user says it; **indirect**: hidden in other content the model reads (e.g. a tradie's quote).
- **How**: `src/agent/untrusted.ts` wraps tenant and tradie messages in `<untrusted_message>` and the system prompt says it's data, not instructions; a detected injection → escalate and flag, nothing sent. Eval scenarios `prompt-injection` and `injection-in-tradie-quote` cover both. The real defence is K5 (the model can't see dangerous tools) + K10 (decisions live in code).
- **Why**: a model can't separate instructions from data 100% of the time, so the prompt alone isn't enough.
- **One-liner**: "Outside messages are always data; even if the model is fooled, it has no permission to do anything dangerous."

### K13 Context engineering
- **What**: deciding what goes into the context on each model call.
- **How**: `src/agent/context.ts`: the current job, property details, the last 12 messages, the actions the current state allows. All of it is structured data, **queried with SQL**, no RAG.
- **Why**: tighter context means a more accurate and cheaper model; irrelevant data distracts it.
- **One-liner**: "The model gets hand-picked current information, not everything."

### K14 Prompt caching
- **What**: cache the unchanging start of the request (system prompt + tool definitions) so later hits are cheaper and faster.
- **How**: `cache_control: { type: 'ephemeral' }` in `src/agent/llm.ts`; cache_read tokens in `llm_calls` show the effect. Prefixes below the minimum cacheable length simply don't cache.
- **Why**: every call repeats the same system prompt and tools; paying for them every time is waste.
- **One-liner**: "Stable parts first and cached, changing parts last."

### K15 Durable execution / Inngest
- **What**: a process lasting days can't depend on one program staying up; it must sleep, wake on events, retry on failure and survive restarts.
- **How**: `src/workflows/functions/job-advance.ts`: event-triggered, `retries: 3`, `onFailure` escalates to the manager; state lives in the `jobs` table. Scheduled jobs use Inngest cron too.
- **Why**: a tradie may take days to reply; servers restart and serverless functions time out.
- **One-liner**: "Work that waits for days can't live in memory: state in the DB, events wake it, failures retry, a human is the last resort."

### K16 Concurrency control / optimistic locking
- **What**: one job must not be processed twice at once (tenant and tradie message at the same moment).
- **How**: two layers: ① Inngest concurrency key = job ID (`perJobConcurrency`, `src/workflows/concurrency.ts`) so runs for a job queue up; ② `transitionJob` in `src/domain/jobs.ts` uses a `version` column for optimistic locking, failing on a stale version. Duplicate inbound messages throw `DuplicateInboundError`.
- **Why**: concurrency corrupts state and duplicates actions.
- **One-liner**: "One run per job at a time, with a version number in the DB as the backstop."

### K17 Follow-ups / timeouts
- **What**: chase automatically when nobody replies.
- **How**: `src/workflows/functions/follow-ups.ts` sweeps the `follow_ups` table every 5 minutes and chases or moves on when an item is due.
- **Why**: "waiting" becomes a DB row, not a process left hanging.
- **One-liner**: "A wait is a row with a due time, handled by a periodic sweep."

### K18 Multi-model / failover / circuit breaker
- **What**: switch to a backup when the main model is down; stop calling a provider for a while after repeated failures (circuit breaker).
- **How**: Claude, DeepSeek and Kimi (the latter two via an OpenAI-compatible client, `src/agent/providers/`). `resilience.ts`: 3 failures in 60 s → skip that provider for 60 s; only retryable errors (408/409/429/5xx) fail over. All fail → escalate to a human. Measured escalation precision: Kimi 0.88, Claude 1.0.
- **Why**: one provider is a single point of failure, but any model swap must pass evals.
- **One-liner**: "Provider down → switch; repeated failures → circuit opens; nothing works → a human. Every model passes the same evals."

### K19 Rules first / fast intents
- **What**: answer simple fixed cases with rules, no model call.
- **How**: `src/agent/fast-intents.ts`, e.g. a tenant replying "2" to pick a slot, or "thanks, all fixed" to confirm completion.
- **Why**: faster, cheaper, more reliable.
- **One-liner**: "If a rule can handle it, don't call the model."

### K20 Cost / budget / rate limits
- **What**: keeping AI spend under control.
- **How**: every call writes `llm_calls` (cost from `src/agent/pricing.ts`); `src/domain/usage-limits.ts`: the simulator allows 60 messages per organization per hour and a US$5 daily model budget, unpriced calls count as US$0.05. Evals cost about US$0.06 and about 4 calls per scenario; the 17-scenario smoke set about US$1.
- **Why**: a public demo can't run up the bill; cost per job is measurable.
- **One-liner**: "Every call records its cost, and the entry point has rate limits and a daily budget."

### K21 Multi-tenancy / RLS
- **What**: many property companies share one system without seeing each other's data.
- **How**: every row carries `organization_id`; `withOrg` in `src/db/org-scope.ts` switches to the `keyhook_app` DB role and sets the current organization, and Postgres **row-level security (RLS)** filters at the DB level. All access goes through `src/domain/`.
- **Why**: a forgotten `where` in app code still can't leak data; the DB is the backstop.
- **One-liner**: "Isolation isn't just a where clause in code; the database enforces it."

### K22 Three eval layers / fake LLM / red team
- **What**: AI output is non-deterministic, so fixed assertions don't work; test in layers.
- **How**:
  1. **Code tests**: a scripted fake model `src/test/fake-llm.ts` tests the state machine, money, idempotency and isolation; 290+ tests on every commit.
  2. **Scenario evals**: 84 YAML files in `evals/scenarios/` (e.g. `emergency-gas-smell.yaml`) run end to end on the real model, checking urgency, trade, and escalation recall/precision; **forbidden actions must be 0**. `pnpm eval`; smoke set of 17 (`pnpm eval:smoke`); full run nightly at 03:00 NZ.
  3. **Finding what you didn't think of**: `pnpm redteam` (one AI plays a bad tenant, another scores; it really caught the agent falsely claiming a tradie was booked) + mistakes managers flag on the dashboard → `pnpm eval:harvest` drafts scenarios, **a human reviews them**, then they join layer 2.
- **Why**: each layer tests something different; each mistake happens only once.
- **One-liner**: "Fake model tests code, real model tests judgement, red team and production corrections find blind spots, and reviewed cases join the set for good." (Fake·Real·Red)

### K23 Observability / tracing
- **What**: seeing what happened on every model and tool call.
- **How**: Langfuse for LLM tracing (`src/lib/telemetry.ts`), Sentry for errors; in the DB, `llm_calls` (tokens, cost, latency, success/failure) and `audit_log`; `src/domain/agent-trace.ts` and `agent-stats.ts` feed the dashboard.
- **Why**: when the AI gets something wrong, you can find which call and which input.
- **One-liner**: "Every job can replay the AI's full decision path."

### K24 CI/CD / AI code review
- **What**: continuous integration for an AI system: code tests + eval gates + AI review.
- **How**: `.github/workflows/ci.yml` (`pnpm check`: format, types, lint, tests), `eval.yml` (nightly evals), `review.yml` (risk-tier label A/B/C by changed paths, `review/risk.ts`; reviewer and security-reviewer agents on PRs, `review/pr-review.ts`; `review/docs-sync.ts` checks bilingual docs). First AI review: 46 s, US$0.33, caught 3 issues the author missed. Production migrations and Inngest sync are still manual.
- **Why**: a prompt change needs gates just like a code change; risky changes get stricter review.
- **One-liner**: "Prompt changes go through PRs, tests and evals like code, with review strictness set by risk tier."

### K25 Other agents
- **Ops analyst**: `src/agent/ops/analyst.ts`, Mondays 07:00 NZ by cron or on demand, turns each organization's operating data into insights.
- **Portfolio monitor**: daily at 06:00, finds repeated faults (`src/domain/portfolio-monitor.ts`).
- **Arrears agent**: its own state machine and tools; sending a formal notice (`send_arrears_notice`) needs approval.
- **Media retention**: photos deleted daily after 180 days (`media-retention.ts`).
- **One-liner**: "Several agents run on one platform (state machine, tool gateway, audit, evals); the platform is the real asset."

### K26 Money / time
- **What**: the places bugs love most.
- **How**: money is integer cents (NZD), never floats; times stored in UTC, shown in Pacific/Auckland. Invoice checks in `src/domain/invoice-check.ts`: tolerance 5% / NZ$50 (`INVOICE_TOLERANCE`).
- **Why**: 0.1 + 0.2 ≠ 0.3 in floating point; time zones and daylight saving break deadlines.
- **One-liner**: "Money in integer cents, time in UTC."

---

# Part B: what ShopAssist uses

> ShopAssist is a fictional e-commerce support platform that covers the technologies Keyhook doesn't
> use. Details: [example project](interview-example-project.md).

### S1 LLM gateway / model routing
- **What**: the single entry point for model calls, doing routing, failover, budgets and caching.
- **How**: intent classification → self-hosted small model; after-sales judgement → large model; reply writing → small model. Daily budgets per team and feature.
- **Why**: tasks differ in difficulty and one large model for everything is too expensive; one entry point allows one set of controls.
- **One-liner**: "Small models for easy tasks, large for hard ones; the gateway owns routing, failover and budgets." (Keyhook: K18, K20; too small for a separate gateway service)

### S2 Fine-tuning
- **What**: training a model further on your own labelled data to do one task better.
- **How**: only for intent classification: 50,000 calls a day, about 30 fixed classes, hundreds of thousands of labelled examples.
- **Why**: worth it only when high-volume + fixed + data-rich; changing knowledge goes in RAG, behaviour in prompts.
- **One-liner**: "Knowledge in RAG, behaviour in prompts; fine-tune only high-volume, fixed, data-rich tasks."

### S3 LangGraph
- **What**: a framework that runs an agent flow as a graph, saving after each step (checkpoint) so it can pause and resume.
- **Core concepts**: **State** (shared state, e.g. `{messages, intent, order}`), **Node** (a step or an agent), **conditional edge** (choose the next node from state), **Checkpointer** (state saved to Postgres, survives restarts), **`interrupt()`** (pause for a human, resume from the same point after approval).
- **How**: input guardrail → router → pre-sales / orders / after-sales / handoff → output guardrail.
- **Why**: conversations are open-ended and customers change topic, so control must move flexibly between agents.
- **One-liner**: "Open conversation, switching between agents, pause and resume → LangGraph; fixed process → a state machine."

### S4 Multi-agent / supervisor pattern
- **What**: a router (supervisor) agent hands work to specialist agents.
- **How**: router + pre-sales Q&A, orders and after-sales specialists; a specialist can hand control back. Each specialist loads only its own tools (S7).
- **Why**: fewer, more focused prompts and tools per agent are more accurate.
- **One-liner**: "One dispatcher, several specialists, each seeing only its own tools."

### S5 Temporal
- **What**: a durable-execution engine (same family as Inngest) with timers, signals and retries that guarantees a workflow finishes.
- **How**: returns: create the return → wait up to 7 days for the parcel (reminder on day 3) → courier-delivered signal → inspection → refund (idempotent).
- **Why it's needed besides LangGraph**: LangGraph owns "how this conversation goes" (seconds to hours); Temporal owns "this gets done days later" (days to months). The business DB is the source of truth.
- **One-liner**: "Two kinds of state with different lifetimes: conversation state in LangGraph, multi-day processes in Temporal."

### S6 MCP (Model Context Protocol)
- **What**: a standard protocol for connecting agents to tools and data, "USB-C for AI".
- **How**: one MCP server each for orders, CRM, logistics and payments, owned by those teams; the support agents, the analyst agent and developers' Claude Code share them. A tool gateway in between does permissions, idempotency, audit and rate limits.
- **Why**: many agents reuse one set of tools. **MCP is only the connection; governance is yours.**
- **One-liner**: "MCP solves how to connect; your own gateway still handles permissions and audit." (Keyhook: direct calls in one codebase; MCP planned)

### S7 Too many tools / load on demand
- **What**: with many tools, models pick wrong ones and waste context.
- **How**: 60+ tools, each specialist loads only its own (the orders agent sees 8). Tool search can also load them on demand.
- **One-liner**: "Each agent gets only the tools it needs." (Keyhook: handler per state, K3)

### S8 RAG / chunking / embeddings / vector DB
- **What**: retrieval-augmented generation: find relevant content in a corpus first, then put it in the prompt.
- **How**: split documents by headings and paragraphs (~500 tokens, overlapping) → add metadata (category, policy version, effective date) → embed → store in pgvector, plus a full-text index.
- **Why pgvector**: under a million or so chunks; lives in the same Postgres as business data, so transactions and permission filters work; one less system.
- **One-liner**: "RAG only when there's too much changing material to fit in context."

### S9 Hybrid search / BM25 / reranking
- **What**: vector search (by meaning) plus BM25 keyword search (by exact text), then a reranker picks the most relevant.
- **How**: hybrid search → metadata filter (current policy versions only) → rerank top-50 to top-5 → answers must cite sources.
- **Why**: model numbers like "WH-1000XM5" need exact matches, which vectors are bad at; reranking improves precision.
- **One-liner**: "Semantic search finds meaning, keyword search finds model numbers, reranking picks the best."

### S10 Agentic RAG / agentic search
- **What**: instead of one fixed retrieval, search is a tool and the agent decides how many searches and which terms.
- **How**: the after-sales agent has search-policies, search-manuals and search-past-tickets tools.
- **One-liner**: "RAG isn't obsolete; it became one of the agent's tools."

### S11 Long context vs RAG
- **How**: the core 3-page returns policy goes straight into the system prompt and is cached; everything else is retrieved.
- **One-liner**: "Little material → put it in context; lots, changing, needing filters → retrieve."

### S12 Memory short / long term
- **What**: short term = within this conversation; long term = remembering the user across conversations.
- **How**: short term → LangGraph checkpointer; structured long term (membership tier, preferences) → Postgres; conversation summaries → Postgres; past tickets → pgvector. Privacy: no full phone numbers or addresses, deletable on request, purged by retention period.
- **One-liner**: "Short-term memory follows the conversation; long-term memory is structured, summarised or semantic." (Keyhook: only the last 12 messages of the job, K13)

### S13 Compaction
- **What**: when a conversation gets long, summarise early parts and keep the key facts.
- **One-liner**: "Context is limited: compress the old, keep the new verbatim."

### S14 Agent harness / Agent SDK
- **What**: the harness is everything around the model: the loop, tools, context management, permissions, sandbox, memory files. The Claude Agent SDK is a ready-made harness (the one Claude Code uses).
- **How**: the ops analyst agent ("why did returns rise last month?") queries data → writes analysis code → runs it → reads results → analyses again.
- **Why**: the task is open-ended; nobody knows in advance which tables or analyses are needed.
- **One-liner**: "Fixed process → state machine or graph; open-ended task → a general harness."

### S15 Subagents
- **What**: the main agent sends subagents with their own context to do subtasks and gets back only conclusions.
- **How**: three subagents analyse headphones, speakers and chargers in parallel.
- **Why**: faster in parallel; the main context isn't flooded with detail.
- **One-liner**: "Subagents work in their own context and hand back only the conclusion."

### S16 Hooks
- **What**: program checks that run automatically before or after an agent action.
- **How**: before every SQL query: no `DELETE/UPDATE`, a time range is required.
- **One-liner**: "Hooks are rules enforced by code, not by the model's good behaviour." (Keyhook: the tool gateway, K6)

### S17 Sandbox
- **What**: an isolated environment where AI-written code can run safely.
- **How**: isolated container, no network, read-only DB account, CPU/memory/time limits.
- **One-liner**: "AI-written code only runs in a cage."

### S18 Skills / progressive disclosure
- **What**: a skill is a folder (instructions + scripts + references) capturing how to do a kind of task. Only a one-line summary sits in context until it's needed, then the full content loads (progressive disclosure).
- **How**: `weekly-report` (report format + slide script), `return-rate-analysis` (standard method), `sql-safety` (which tables are off limits).
- **Why**: consistent methods; no wasted context.
- **One-liner**: "Skills are the agent's manuals, opened only when needed." (Screwdriver·Manual·Socket: a tool is the screwdriver, a skill the manual, MCP the socket)

### S19 A2A (Agent-to-Agent)
- **What**: a protocol for agents of different companies or systems to discover capabilities, send tasks and receive results.
- **How**: connects to the courier's agent for "book a pickup" and "query a problem parcel".
- **One-liner**: "MCP connects an agent to tools; A2A connects an agent to agents."

### S20 Computer use
- **What**: the model looks at screenshots, clicks and types to drive an interface with no API.
- **How**: submitting restock requests on a supplier's old portal: sandboxed browser, one allowed URL, a screenshot sent to a human before submitting, page text treated as untrusted.
- **One-liner**: "A stopgap when there's no API; retire it once there is one."

### S21 Input/output guardrails / PII redaction
- **What**: checks before and after the model: inputs for injection and personal data; outputs for leaks, unsafe content, brand voice.
- **How**: input classifier + PII redaction; output check for other customers' orders; queries must carry the current customer ID; **indirect injection** (instructions hidden in reviews or manuals and pulled in by RAG) → retrieved content is untrusted too and scanned before indexing.
- **One-liner**: "Gates on both sides of the model; retrieved content is as untrusted as user messages." (Keyhook: K12)

### S22 Hallucination / citations
- **How**: answers must cite the retrieved policy text; if nothing is found, say "not sure" and hand off.
- **One-liner**: "No source, no answer."

### S23 RAG evals / faithfulness
- **What**: test "did retrieval find the right thing" separately from "is the answer based on what was retrieved".
- **How**: 300 questions labelled with their correct documents → retrieval recall and hit rate; faithfulness = whether the answer goes beyond the retrieved content.
- **One-liner**: "Evaluate retrieval and generation separately."

### S24 LLM-as-judge
- **What**: one model scores another's output against a rubric.
- **How**: scores tone and whether the problem was solved; human spot checks calibrate the judge regularly.
- **One-liner**: "A judge model needs human spot checks to stay calibrated." (Keyhook's red team also uses AI scoring, K22)

### S25 Online A/B / canary
- **What**: a new prompt or model gets a small slice of traffic first, then everything if metrics hold.
- **How**: 5% of traffic; watch resolution rate, handoff rate, satisfaction, cost; rollback by config.
- **One-liner**: "Passing offline evals still needs a small live trial."

### S26 OpenTelemetry / tracing
- **How**: one trace per conversation, containing every model call, retrieval and tool call (Langfuse / LangSmith, built on OpenTelemetry). Metrics: AI resolution rate, handoff rate, tokens, latency, cache hit rate, cost.
- **One-liner**: "One trace ties together every call in a conversation."

---

# Part C: why Keyhook doesn't use X

| Technology | ShopAssist | Keyhook | Reason |
|---|---|---|---|
| LangGraph | Yes | No (state machine) | Fixed process; waiting days is durable execution, already solved by Inngest; progress lives only in business tables, one set of books |
| Durable execution | Temporal | Inngest | Both wait for days; choice depends on team and deployment |
| RAG / vector DB | Yes | No (SQL) | Keyhook's data is all structured; SQL is more accurate |
| MCP | Yes | Planned | Keyhook is one codebase calling tools directly |
| Skills / general harness | Yes (analyst agent) | Not in the product; Claude Code in development | A fixed process already has its "method" in code |
| Fine-tuning | Yes (intent classification) | No | Low volume; prompts are enough |
| A2A / computer use | Yes | No | No cross-company agents, no API-less legacy systems |
| Permissions / idempotency / audit / guardrails / evals / HITL / observability | Yes | Yes | **Every production agent needs them** |

**One-liner**: "Orchestration frameworks, RAG, fine-tuning and Skills depend on the use case; permissions, idempotency, audit, guardrails, evals and human in the loop are the baseline, always."

---

# Part D: 8-step system-design template ("design an AI agent for X")

1. **Clarify**: who the users are, which tasks to close end to end, which actions touch money/safety/law, what scale.
2. **Draw the human/agent boundary**: four tests — reversibility, impact, confidence, accountability (K11).
3. **Pick orchestration**: fixed → state machine (K2); open-ended → LangGraph / Agent SDK (S3, S14); multi-day → durable execution (K15, S5).
4. **Design tools**: list + three permission levels + idempotency + audit (K4–K8); MCP if they must be shared (S6).
5. **Knowledge and memory**: structured → SQL (K13); lots of documents → RAG (S8–S10); little → put it in context (S11).
6. **Security**: direct/indirect injection, privacy, over-permission, hallucination (K12, S21, S22).
7. **Evals**: code tests + scenario evals + red team + online A/B + feedback loop (K22, S23–S25).
8. **Operations**: tracing, cost, failover, CI/CD, canary releases (K18, K20, K23, K24, S25).
