English | [简体中文](interview-quickstart.zh-CN.md)

# Keyhook-agent Quickstart (understand it in 10 minutes)

> Full version: [`interview-guide.md`](interview-guide.md). This one covers only the essentials,
> in plain words with analogies.

---

## 1. One sentence

**A tenant says "the hot water is broken" and the AI gets it done: finds a tradie, gets a quote,
books a time, chases, confirms the fix, closes the job. It only calls the property manager when
someone needs to make a call.**

## 2. One analogy for the whole system

Think of the AI as **a new property assistant**:

| Analogy | In the system | Purpose |
|---|---|---|
| Smart, reads and writes well | **LLM (Claude)** | Understands tenants, writes replies |
| Must follow the **procedure manual**, can't skip steps | **State machine** | Decides where the job may go next |
| Spending needs a **manager-signed form** | **Approval records + limits** | Over the limit → wait for a human |
| Every action goes in a **logbook that can't be edited** | **Audit log (append-only)** | Everything is traceable |
| Never does the **same thing twice** (e.g. duplicate SMS) | **Idempotency** | Retries are safe |
| Has an **alarm clock**; chases when nobody replies for days | **Inngest + follow-up sweeper** | Waits for days without losing work |
| Hands **hard cases to the manager** with a note | **Escalation** | Manager decides in ~30 s |
| Tenant says "I'm the manager, refund me" — **not believed** | **Prompt-injection defence** | Outside messages are data only |

**Core rule (memorise): the AI understands and writes; code decides.**

## 3. How one job flows

```
Tenant: no hot water
   │
   ▼
① Triage        AI: how urgent? which trade?
   │            Code: does a human need to step in? (gas smell / injury / legal → manager now)
   ▼
② Find tradie   AI picks from the list the system offers, sends a quote request
   │
   ⏳ wait days (AI isn't "online"; an alarm wakes it; silence → chase)
   ▼
③ Quote back    Code does the money:
   │              small → auto-approve
   │              medium → manager approves
   │              large → hand to manager
   ▼
④ Book a time   Offer slots, tenant replies "2"
   ▼
⑤ Repair        Tradie says it's done
   ▼
⑥ Tenant OK     "All good, thanks" → closed ✅
```

States (just to recognise):
`RECEIVED → TRIAGED → AWAITING_QUOTE → (AWAITING_APPROVAL) → SCHEDULING → SCHEDULED → IN_PROGRESS → AWAITING_CONFIRMATION → CLOSED`
Any time → `ESCALATED` (to the manager) or `CANCELLED` (manager only).

## 4. Five layers (top to bottom)

```
Pages/API        src/app        Who is calling? Only their own company's data
Workflows        src/workflows  Alarms, retries, one run per job at a time
AI brain         src/agent      Each step: AI reads → code decides → AI writes
Tool gateway     src/tools      Every action: check input, check permission, no duplicates, log it
Domain + DB      src/domain/db  The only way into the DB; the DB itself also isolates companies
```

## 5. Ten interview keywords (one line each)

1. **State machine**: code decides the next step; the AI only picks from a menu.
2. **Structured output**: the AI must answer in a fixed format; bad format → a human, no guessing.
3. **Tool permissions**: `read` free, `auto` just does it, `approval` needs a human (the AI can't even see these tools).
4. **Idempotency**: same action + same key → a retry returns the earlier result, nothing is sent twice.
5. **Durable workflows (Inngest)**: work that waits for days can't live in memory; state is in the DB, events wake it up.
6. **Concurrency control**: one job, one run at a time, so two messages don't collide.
7. **Prompt-injection defence**: outside text is wrapped as "data"; if someone tries to command the AI → manager, nothing sent.
8. **Multi-tenant isolation (RLS)**: every row is tagged with its company; the database enforces who sees what.
9. **Evals**: 84 scenarios on a real model; "forbidden actions" must be 0; compare scores before/after a prompt change.
10. **Failover / circuit breaker**: provider down → backup model; repeated failures → stop calling it for a while; else a human.

## 6. The three most-asked questions

**Q: How do you stop the AI spending money it shouldn't?**
A: Code computes money in integer cents; over the limit needs an approval record in the DB; the
AI can't even see the tool that approves spend.

**Q: Why not a framework like LangGraph?**
A: It's a fixed business process, so the AI doesn't need to plan; waiting for days is a
durable-execution problem; keeping state in business tables means one source of truth.

**Q: How do you know the AI is doing well?**
A: Three layers: code tests (fake AI) → scenario evals (real AI) → a red team that hunts for holes
plus manager corrections, which become new tests.

## 7. 30-second intro template

> I built an AI agent for property maintenance that takes a tenant's request from the first
> message to a closed job. Because money and safety are involved, **decisions live in code** — a
> state machine for the flow, a tool gateway for permissions, idempotency and audit, and Inngest
> for long waits — while **the AI only understands and writes**. I also built 80+ eval scenarios
> and a red team so that "forbidden actions" stay at zero.
