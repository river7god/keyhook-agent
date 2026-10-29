English | [简体中文](interview-example-project.zh-CN.md)

# Example Project: One E-commerce Support Agent That Uses Every Technology

> **Why another example?** Keyhook deliberately doesn't use LangGraph, RAG, Skills and so on. To explain those in interviews, here is a fictional project, **ShopAssist**. Each technology answers just three things: **what it is · where it's used · why**.
> All numbers are made up to illustrate trade-offs.

---

## 1. What the project is

**ShopAssist**: AI customer support for an online electronics retailer.

- **Customers**: ask about products, track orders, return or exchange
- **Support staff**: only take what the AI can't handle
- **Supervisors**: approve large refunds
- **Ops team**: want to know "why did returns go up?"

Scale: 50,000 enquiries a day, 2,000 products, hundreds of pages of policies and manuals. Goal: 70% resolved by the AI end to end.

---

## 2. Architecture (top to bottom)

```
Channels (web · app · WeChat)
   ↓
Conversation  LangGraph: router agent → pre-sales / orders / after-sales agents → human handoff
   ↓ work that waits for days (returns)
Process       Temporal: wait for parcel → inspect → refund
   ↓
Tools         MCP servers (orders · shipping · payments) + permission / idempotency / audit gateway
Knowledge     RAG: pgvector + keyword search + reranking
Memory        customer profile + conversation summaries
Models        LLM gateway: routing · caching · failover · budgets

On the side:  ops analyst agent (Agent SDK + Skills + sandbox)
              supplier portal agent (computer use)
              courier's agent (A2A)
```

---

## 3. One request, step by step

Customer: **"The headphones I bought last week have no sound on the left. Can I return them?"**

| Step | What happens | Technology |
|---|---|---|
| 1 | Check for injection, mask the phone number | Guardrails, PII redaction |
| 2 | Intent = return, hand to after-sales agent | Multi-agent, fine-tuned small model |
| 3 | Sees a VIP who prefers exchanges | Long-term memory |
| 4 | Look up the order: delivered 7 days ago, ¥899 | Tool calling, MCP |
| 5 | Look up policy: faulty within 15 days can be returned | RAG |
| 6 | ¥899 > ¥500 auto limit → pause for a supervisor | Human in the loop |
| 7 | Supervisor approves → resume from the same point | LangGraph checkpoint |
| 8 | Start the return, wait 7 days for the parcel → refund | Temporal, idempotency |
| 9 | Every call recorded throughout | Tracing, audit |

---

## 4. Each technology in one line

### Models
| Tech | What it is | Used here for | Why |
|---|---|---|---|
| **LLM gateway** | One entry point for every model call | Small models for easy tasks, large for hard; switch on outage | One place to control cost and failures |
| **Prompt caching** | Cache the fixed start of each request | System prompt + tool definitions | Cheaper and faster |
| **Structured output** | Model must answer in a JSON shape | `{intent, confidence}`; invalid → human | Code can rely on the result |
| **Fine-tuning** | Further training on your own data | Intent classification only (30 classes, hundreds of thousands of labels) | Only worth it for high-volume fixed tasks |

> Rule of thumb: **knowledge in RAG, behaviour in prompts, fine-tune only high-volume fixed tasks.**

### Orchestration
| Tech | What it is | Used here for | Why |
|---|---|---|---|
| **LangGraph** | Runs a flow as a graph, saving after every step | Router → specialist agents → output | Conversations are open; customers change topic |
| **Multi-agent** | One dispatcher + several specialists | Router + pre-sales / orders / after-sales | Each specialist is focused, with fewer tools |
| **Temporal** | A workflow engine that can wait days and always finishes | Returns: wait 7 days → inspect → refund | Servers restart; the process can't be lost |

LangGraph in 5 words: **State** (shared data) · **Node** (a step) · **conditional edge** (where next) · **Checkpointer** (save) · **interrupt** (pause for a human).

> Rule of thumb: **LangGraph runs "how this conversation goes"; Temporal runs "this gets done days later".**

### Tools
| Tech | What it is | Used here for | Why |
|---|---|---|---|
| **Tool calling** | Model says which tool to call; code runs it | Look up orders, create returns, refund | Model proposes, code executes |
| **Three permission levels** | read / auto / approval | Under ¥500 refunds run automatically; above needs approval, and the model can't see that tool | Prevent over-reach |
| **MCP** | A standard protocol for connecting tools ("USB-C for AI") | One MCP server each for orders, shipping, payments | Many agents share one set of tools |
| **Load on demand** | Each agent gets only the tools it needs | 60 tools; the orders agent sees 8 | Too many tools → wrong picks |

> Note: **MCP only solves how to connect; permissions and audit need your own gateway.**

### Knowledge
| Tech | What it is | Used here for | Why |
|---|---|---|---|
| **RAG** | Retrieve material first, then let the model answer | Policies, manuals, past tickets | Too much changing material to fit in context |
| **Chunks + vectors** | Split documents into pieces, store them as vectors | ~500 tokens per chunk in pgvector | Search by meaning |
| **Hybrid search** | Vector search (meaning) + keyword search (exact text) | Model numbers like "WH-1000XM5" must match exactly | Vectors are bad at exact codes |
| **Reranking** | A second model picks the most relevant | Top 5 out of 50 | More accurate |
| **Agentic RAG** | Search becomes a tool; the agent decides how often | Search policies, manuals, tickets | Hard questions need several searches |

> Rule of thumb: **little material → put it in context; lots, changing, needs filtering → RAG.**

### Memory
| Type | What | Where |
|---|---|---|
| Short term | This conversation | LangGraph checkpoint |
| Long term | Membership tier, preferences, past summaries | Postgres |
| Semantic | How similar problems were solved | pgvector |

Conversation too long → compress the early part into a summary (compaction).

### Ops analyst agent (open-ended work)
Ops asks "why did returns go up last month?", and the agent queries data, writes analysis code and produces a report on its own.

| Tech | What it is | Used here for |
|---|---|---|
| **Agent SDK / harness** | A ready-made agent runtime (the one behind Claude Code) | Decides what to query and compute |
| **Sandbox** | An isolated place to run AI-written code | No network, read-only account, time limits |
| **Subagents** | Sent off on subtasks, bring back only conclusions | Three product categories analysed in parallel |
| **Hooks** | Automatic checks before or after an action | Block DELETE/UPDATE before running SQL |
| **Skills** | A how-to manual, loaded only when needed | Weekly report format, return-rate method |

> Rule of thumb: **a tool is the screwdriver, a skill is the manual, MCP is the socket.**

### Outside connections
| Tech | What it is | Used here for |
|---|---|---|
| **A2A** | A protocol between agents | Book pickups with the courier's agent |
| **Computer use** | Model looks at screenshots and clicks | Drive a supplier's old site with no API; a human confirms before submit |

> Rule of thumb: **MCP connects tools; A2A connects agents.**

### Safety, evals, operations
| Area | What's done |
|---|---|
| **Injection** | Customer messages are data; retrieved content is untrusted too (indirect injection) |
| **Privacy** | Redact inputs; only the current customer's orders can be queried |
| **Hallucination** | Answers must quote the policy; nothing found → human |
| **Human in the loop** | Short waits use `interrupt`; multi-day ones use an approvals table |
| **Evals** | Unit tests → RAG evals (did search find it?) → 500 scenarios → AI judge → red team → 5% live A/B |
| **Observability** | One trace per conversation (Langfuse); watch resolution rate, handoff rate, cost |
| **Releases** | Prompts in git, changes pass evals; 5% of traffic first, then everyone |

---

## 5. Compared with Keyhook (the most valuable part in interviews)

| Tech | ShopAssist | Keyhook | Why |
|---|---|---|---|
| LangGraph | Yes | No | Open conversation vs fixed process |
| Multi-day workflows | Temporal | Inngest | Both need one; pick by team |
| RAG | Yes | No | Lots of documents vs structured data (SQL is enough) |
| MCP | Yes | Planned | Many agents sharing tools vs one codebase |
| Skills / Agent SDK | Yes | No | Open-ended work vs fixed process |
| Fine-tuning | Yes | No | 50,000 calls a day vs low volume |
| A2A / computer use | Yes | No | Whether there are outside agents or legacy systems |
| Permissions · idempotency · audit · guardrails · evals · HITL | Yes | Yes | **Every production agent needs them** |

> One line: **pick the architecture to fit the case; the safety and quality baseline is always there.**

---

## 6. System design in 8 steps ("design an agent for X")

1. **Clarify**: who uses it, what it does, what touches money or safety, what scale
2. **Draw the human boundary**: reversible? high impact? confident? who's accountable?
3. **Pick orchestration**: fixed → state machine; open → LangGraph / Agent SDK; waits for days → Temporal / Inngest
4. **Design tools**: permission levels + idempotency + audit; MCP if shared
5. **Knowledge**: structured → SQL; many documents → RAG; few → put in context
6. **Security**: injection, privacy, over-reach, hallucination
7. **Evals**: offline scenarios + red team + live A/B
8. **Operations**: tracing, cost, failover, gradual rollout

> **30-second summary**: "I draw the human/agent boundary first, then pick the architecture for the task: a state machine for fixed processes, LangGraph for open conversations, Temporal or Inngest for multi-day work; RAG for lots of documents, SQL for structured data. Whatever the choice, permissions, idempotency, audit, guardrails, evals and human in the loop are a must. That's how Keyhook ended up with a state machine plus Inngest, and no LangGraph or RAG."
