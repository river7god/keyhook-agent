English | [简体中文](interview-cheatsheet.zh-CN.md)

# Interview Cheat Sheet + Question Bank

> The five interview documents condensed into **what you can memorise**. Each → points to the
> source for depth.
> [Quickstart](interview-quickstart.md) · [Full guide](interview-guide.md) · [Background knowledge](interview-knowledge.md) · [CI/CD](interview-cicd.md) · [Example project](interview-example-project.md)

**How to use**: skim Part 1 daily (10 minutes); cover the answers in Part 2 and test yourself;
read Part 3 the night before.

---

# Part 1: Memorise

## 1. One sentence + one line (must know)

- **The project**: a tenant reports a fault and the AI takes it from the first message to a closed
  job; it calls the property manager only when judgement or authority is needed.
- **Key line**: **"The model extracts and writes; code decides."**
- **Positioning**: a **transactional** agent (money, safety, people's homes), so reliability lives in code.

## 2. Mnemonics (9 — remember these and you can expand on each)

| Mnemonic | Expands to | → |
|---|---|---|
| **8 rules: S-P-I-A / U-M-N-S** | **S**tate machine is truth · tool **P**ermissions · **I**dempotency · **A**udit every action · **U**ntrusted outside text · **M**oney in cents, time in UTC · **N**o real SMS in dev · **S**mall changes | Full guide A7 |
| **E → D → C** | Each handler: LLM **E**xtracts → code **D**ecides → LLM **C**omposes | Full guide A6 |
| **V-P-I-A** | `executeTool`'s four gates: **V**alidate (Zod) · **P**ermission · **I**dempotency · **A**udit | Full guide A7 |
| **RICA** | Four tests for "needs a human": **R**eversibility · **I**mpact · **C**onfidence · **A**ccountability | Full guide A8 |
| **Auto · Approve · Escalate** | Spend: ≤ PM limit auto · ≤ owner limit PM approves · above → escalate | Full guide A5 |
| **Fixed · Long · One** | Why not LangGraph: process is **fixed** · waits are **long** (durable execution) · **one** source of truth | Quickstart §8 |
| **Save · Wake · Chase · Retry · Serialise** | Five needs of durable execution | Quickstart §8 |
| **Fake · Real · Red** | Three eval layers: **fake** AI tests code · **real** AI runs scenarios · **red** team + PM corrections find unknowns | Quickstart §9 |
| **Screwdriver · Manual · Socket** | Tool = ability · Skill = know-how · MCP = standard connection | Knowledge §15 |

## 3. Numbers to remember

| Number | Meaning |
|---|---|
| **12** | Job states (terminal: CLOSED, CANCELLED) |
| **≤ 8 turns** | The only tool loop (TRIAGED only), then a self-check |
| **≤ 6 steps** | Max steps per `advanceJob` run |
| **5 min** | Follow-up sweep interval |
| **3** | Inngest retries before escalating |
| **3 in 60 s** | Circuit breaker: 3 failures in 60 s → skip that model for 60 s |
| **0.7** | Triage confidence threshold; below → escalate |
| **12 messages** | Recent messages in each step's context |
| **84** | Eval scenarios; smoke set **17** ≈ **US$1** |
| **290+** | Code tests |
| **0** | Forbidden actions must be 0 (hard red line) |
| **≈ US$0.06 / ≈ 4 calls** | Per eval scenario; a full job ≈ 10 calls |
| **0.88 vs 1.0** | Escalation precision, Kimi vs Claude |
| **30 s** | An escalation package lets a PM decide in 30 seconds |
| **5 % or NZ$50** | Invoice-match tolerance |
| **46 s / US$0.33 / 3 issues** | First AI code review run, catching what the author missed |

## 4. Five layers (top to bottom)

```
app (auth, RLS) → workflows (Inngest: events, retries, concurrency 1) → agent (E→D→C)
→ tools (V-P-I-A) → domain/db (only entry, org isolation, append-only audit)
```

## 5. The job flow in one breath

```
report → triage (emergency/low confidence/injection/legal → escalate; missing info → ask)
→ find tradie, request quote → [wait days, chase on silence]
→ quote: auto · approve · escalate → book (a reply like "2" goes to a rule, no model call)
→ visit → tenant confirms → close (notify owner, check invoice)
any state → ESCALATED (PM takes over, hand-back only to the prior state) / CANCELLED (PM only)
```

## 6. One line per topic

**Agent design**
- Workflow vs agent: who decides the next step — code or model. Here: workflow + one bounded tool loop.
- Memory: context rebuilt from the DB each step, not a transcript; no vector DB since nothing needs semantic recall.
- Intent funnel: rules → state → model; the cheapest correct layer first.

**Reliability**
- Idempotency: key and effect in one transaction; a retry returns the earlier result. "At-least-once delivery + idempotency = effectively once."
- Optimistic locking: `version` column; claim before acting; the DB is the truth, so a lost event is recovered by the next sweep.
- Failure: refusal / garbage / config error → escalate immediately, no blind retries; jobs never stall silently.

**Security**
- Injection: `<untrusted_message>` wrapping + an injection flag → escalate, send nothing; text in images too.
- Best defence: even if the model is fooled, **it can't do anything dangerous** (approval tools are invisible to it).
- Multi-tenancy: `organization_id` on every row + Postgres RLS; the DB enforces isolation, a missing policy fails a test.
- Residency: each step has a data class; personal data never goes to an unsafeguarded offshore model; misconfig fails closed.

**Wider technology**
- RAG: retrieve, then answer; quality is mostly retrieval (chunking, hybrid search, rerank).
- Is RAG obsolete? The one-size vector pipeline is fading, not retrieval; now it's agentic RAG.
- Vector DB: pgvector at small/medium scale — keeps transactions and RLS.
- LangGraph vs Temporal: LangGraph = "how this conversation goes"; Temporal = "done in a few days".
- Skill: progressive disclosure — one line of summary until needed.
- Harness: the model is the engine, the harness is the car.
- MCP vs A2A: MCP connects agents to tools; A2A connects agents to agents.
- Fine-tuning: knowledge → RAG, behaviour → prompts; fine-tune only high-volume fixed tasks with lots of data.

**CI/CD**
- Two things: agents doing CI/CD + CI/CD for the AI app (LLMOps).
- Guardrails: author ≠ reviewer · deterministic checks first · least privilege · sandbox · agents can't change their own guardrails · no secrets for fork PRs.
- Risk tiers A/B/C: docs auto-merge → normal code one human → DB/permissions/prompts/CI two humans.

## 7. Judgement (what shows seniority)

| Depends on the situation | Always required |
|---|---|
| Orchestration framework, RAG, fine-tuning, Skills, A2A, computer use | Permission levels, idempotency, audit, guardrails, evals, human-in-the-loop, observability |

> "State machine for fixed processes; LangGraph for open conversations; durable execution for
> anything spanning days; RAG for lots of changing knowledge, SQL for structured data."

---

# Part 2: Question bank (cover the answers and test yourself)

## A. About the project

**1. Tell me about your project.**
> An AI agent for NZ property maintenance: from a tenant's report it triages, finds a tradie,
> handles quotes and approvals, books, chases and closes, calling a manager only for judgement or
> authority. Money and safety are involved, so decisions live in code — a state machine, a tool
> gateway, Inngest — and the AI only understands and writes. 84 eval scenarios keep forbidden actions at 0.

**2. What business problem does it solve?**
> One maintenance job involves 4 people, 3 systems and ~9 manual steps. The AI coordinates, the
> manager moves from doing to supervising, and each manager can run more properties.

**3. Why "transactional" agent, and why does it matter?**
> Its actions have real consequences — spending money, sending someone to a home, legal notices —
> so key decisions must be predictable, auditable and reversible, not left to the model.

## B. Architecture and agent design

**4. Describe the architecture.**
> A modular monolith in five layers: app (auth + RLS) → workflows (Inngest) → agent (one handler
> per state) → tools (one gateway) → domain/db (the only data path). No microservices: one team,
> and the interfaces are seams for later extraction.

**5. What does the LLM do, and not do?**
> Does: understand messages (structured extraction), read photos, write replies, pick a tradie in
> one bounded loop. Doesn't: choose the next state, compute money, decide escalation — code does.

**6. How does the state machine stop the AI skipping steps?**
> Transitions are in code; every write goes through `checkTransition`. The model only sees the
> allowed-transition menu. Optimistic locking prevents concurrent conflicts.

**7. Where's the only tool loop, and how is it bounded?**
> In TRIAGED: the model picks tools to find a tradie and request a quote. Max 8 turns, then code
> checks "did the state really move?"; if not, escalate.

**8. How is agent memory done?**
> Context rebuilt from the DB each step: job, property, tenancy, last 12 messages, past jobs.
> Long-term memory is the database itself. No vector DB — the data is structured.

**9. Why not LangGraph?**
> Fixed · Long · One: the process is fixed, so a state machine is enough; waits are days long, a
> durable-execution problem solved by Inngest; state lives only in business tables. For open-ended
> tasks I'd consider it.

**10. How do you implement waiting days?**
> State in the DB, nothing in memory. Inngest events wake it; follow-ups are swept every 5 minutes
> and claimed before acting; 3 retries then escalate; concurrency 1 per job.

## C. Reliability

**11. How do retries avoid duplicate SMS?**
> Idempotency key = job version + triggering message + tool name + call index, in the same
> savepoint as the effect. Replays return the stored result; same key with a different request errors.

**12. Two messages arrive for one job at once?**
> Inngest concurrency key = job ID serialises them; inbound messages are processed at most once,
> and a duplicate is detected and aborted.

**13. The model returns garbage or refuses?**
> Structured output + Zod; failures raise `LlmOutputError`/`LlmRefusalError` and escalate with the
> reason. No blind retries — another model doesn't fix a content problem.

**14. The provider goes down?**
> Per-step timeouts, a fallback model, and a breaker (3 failures in 60 s → skip 60 s). Permanent
> errors (auth, balance) escalate. Emergencies always reach a person.

**15. Why never call the LLM inside a DB transaction?**
> It's slow and would hold connections and locks. Do the LLM work first, then apply all effects in
> one short transaction.

## D. Security

**16. How do you defend against prompt injection?**
> Outside text wrapped in `<untrusted_message>` with closing tags neutralised; extraction has an
> injection flag → escalate, send nothing; same for text in images. More importantly the model
> can't reach dangerous tools anyway.

**17. How do you stop the AI spending money it shouldn't?**
> Code computes money in integer cents; over the limit needs a stored approval record; the
> spend-approval tool is invisible to the model.

**18. How is multi-tenancy isolated?**
> `organization_id` on every row, composite FKs, Postgres RLS with a restricted role per request
> transaction; any table missing an RLS policy fails a test.

**19. How is auditing done?**
> Every tool call and transition writes a row (who, what, why, input, output, trace id) to an
> append-only table; a DB trigger rejects changes.

**20. Privacy and offshore data?**
> Each step has a data class; personal-data steps can't use unsafeguarded offshore models (NZ
> Privacy Act IPP 12); misconfiguration is refused and escalates; Sentry is scrubbed before sending.

## E. Evals and quality

**21. How do you know the AI is doing well?**
> Fake · Real · Red: a fake AI tests code logic on every commit; 84 scenarios on the real model
> nightly with zero forbidden actions; the red team and PM corrections find unknowns, which join
> the set after human review.

**22. What does an eval scenario look like?**
> A YAML file: input (tenant: "gas smell in the kitchen") + expectations (emergency, escalate,
> never request a quote). Run and scored.

**23. What real problems did evals find?**
> The red team caught the agent claiming things were arranged when they weren't, continuing after
> "don't send anyone yet", and a summary saying "acknowledged tenant" when nothing was sent. Fixed
> by composing only from a fact list, kept as regression scenarios.

**24. Why check the escalation reason, not just the outcome?**
> Right outcome for the wrong reason is a latent bug that fails on the next input.

**25. Is LLM-as-judge reliable?**
> With a clear rubric and human calibration. Here the judge also sees the system's tool results,
> not just the text.

## F. Models and cost

**26. How do you choose models?**
> By eval score and cost, not preference, per step. Kimi's escalation precision was 0.88 vs
> Claude's 1.0 — every wrong escalation costs PM time, so cheap tokens can be expensive.

**27. How do you save cost?**
> Rules first (fixed short replies skip the model), prompt caching on the stable prefix, smaller
> same-provider models for simple steps (after evals pass), daily budgets, cost recorded per call.

**28. What does a job cost?**
> ≈ US$0.06 and 4 calls per eval scenario; a full job ≈ 10 calls, ≈ US$0.10–0.20 — far below the
> cost of a person doing it.

## G. Wider knowledge

**29. What is RAG, and when do you use it?**
> Retrieve relevant material, then answer — for private or recent knowledge the model lacks. Use
> it for large, changing, permission-filtered material. Here the data is structured, so SQL is better.

**30. Some say RAG is obsolete — your view?**
> The one-size vector pipeline is fading. Small material goes in context with caching; large
> material still needs retrieval, increasingly as a tool the agent calls (agentic RAG).

**31. How do you pick a vector DB?**
> pgvector first at small/medium scale — same DB, transactions, RLS. A dedicated vector DB only at
> hundreds of millions of vectors or high QPS.

**32. Tool vs Skill vs MCP?**
> Screwdriver · Manual · Socket: a tool is an ability, a skill is know-how (progressive
> disclosure), MCP is the standard connection for tools. Complementary.

**33. What is an agent harness?**
> Everything around the model: loop, tools, context management, memory files, subagents, hooks,
> permissions, sandbox. The same model performs very differently in different harnesses.

**34. MCP vs A2A?**
> MCP connects agents to tools; A2A connects agents to agents.

**35. When do you fine-tune?**
> Prompt first, add RAG for missing knowledge, fine-tune only high-volume fixed tasks with lots of
> data. Knowledge → RAG, behaviour → fine-tuning.

**36. Can LangGraph and Temporal be used together?**
> Yes. LangGraph orchestrates within a conversation (seconds to hours), Temporal runs multi-day
> business processes. Business state lives in the DB; checkpoints hold only conversation context.

## H. CI/CD

**37. How do you use AI in CI/CD?**
> Two independent review agents (review + security) advise on every PR; changed paths set an
> A/B/C risk tier automatically; only deterministic checks block merges; a human decides. Prompt
> and model changes must pass evals.

**38. Would you let AI auto-merge?**
> By risk tier. Low-risk (docs, tests) once the data shows it's reliable; DB, permissions, prompts
> and CI always need a human, and agents can't change their own guardrails.

**39. Why separate writing and reviewing agents?**
> Same context, same blind spots. Our first review run — 46 s, US$0.33 — caught a "test that could
> never fail" the author missed.

**40. How do you protect CI agents from attack?**
> PR/issue text is untrusted; fork PRs get no secrets and no `pull_request_target`;
> least-privilege tokens; coding agents run in sandboxes.

## I. System design and open questions

**41. Design an e-commerce support agent.**
> Eight steps: clarify → human/agent line → orchestration (LangGraph for open chat, Temporal for
> multi-day returns) → tools (permissions + idempotency + MCP) → knowledge (RAG + hybrid search for
> policies and manuals) → security (direct and indirect injection) → evals (scenarios + RAG evals
> + red team + A/B) → operations. → Example project

**42. What are the project's weaknesses? What's next?**
> Tool outputs aren't validated; long threads keep only the last 12 messages instead of
> summarising; no per-provider token bucket; breaker state is per process; production migrations
> and Inngest sync are manual. Next: release automation, evals as a PR gate, tools as an MCP server.

**43. What if scale grew 100×?**
> Extract along the seams — messaging gateway, then LLM gateway, then media; partition big tables
> monthly; read replicas; move to an AWS NZ region if residency requires. Every move needs a
> trigger, not "big companies do it".

**44. Your most important technical decision?**
> Code decides; the model only extracts and writes. That makes the system testable, auditable and
> predictable in cost, and lets me safely use cheaper models for simple steps.

---

# Part 3: The night before

## 30-second intro

> "I built an AI agent for property maintenance that takes a tenant's request from the first
> message to a closed job. Because money and safety are involved, **decisions live in code** — a
> state machine for the flow, a tool gateway for permissions, idempotency and audit, and Inngest
> for long waits — while **the AI only understands and writes**. I built 84 eval scenarios and a
> red team so forbidden actions stay at zero, and two independent AI review agents check every PR."

## Don't say ❌ → Say ✅

| ❌ | ✅ |
|---|---|
| "The AI decides whether to refund / send someone" | "The AI extracts; code decides by rule" |
| "RAG is dead" | "The one-size vector pipeline is fading; retrieval became an agent tool" |
| "LangGraph is bad" | "LangGraph suits open-ended orchestration; mine is a fixed process" |
| "Our AI is very accurate" | "Escalation precision 1.0 and zero forbidden actions across 84 scenarios" |
| "We used lots of frameworks" | "What each technology solves, and why I used it or not" |
| "AI reviews code, so we don't need people" | "Deterministic checks block, AI advises, humans decide" |

## Universal answer frame

For any technology: **problem it solves → how it works → costs → why I used it or not → what would change my choice**
