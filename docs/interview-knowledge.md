English | [简体中文](interview-knowledge.zh-CN.md)

# AI Engineering Background Knowledge (interview supplement)

> Companions: [Quickstart](interview-quickstart.md) · [Full guide](interview-guide.md).
> This project deliberately does **not** use LangGraph, a vector database or RAG. In an interview,
> explaining "what it is + why not here + when I would use it" is a strength, not a gap.

Format for every topic:
**What** → **How it works** → **One-line answer** → **Link to this project** → **Likely follow-ups**

Priority: ⭐⭐⭐ must know · ⭐⭐ should know · ⭐ awareness

---

## 1. AI agent basics ⭐⭐⭐

**What**: an LLM + tools + a loop. The model doesn't just answer; it calls tools, reads results
and keeps acting until the task is done.

**How (ReAct pattern)**:
```
Think (what should I do) → Act (call a tool) → Observe (tool result) → Think again … → Final answer
```

**Workflow vs agent** (the core distinction in Anthropic's *Building Effective Agents*):
| | Workflow | Agent |
|---|---|---|
| Who decides the next step | Code | Model |
| Predictability | High | Low |
| Good for | Fixed business processes | Open-ended tasks (coding, research) |

**Common patterns**:
- **Prompt chaining**: one step's output feeds the next
- **Routing**: classify first, then hand to a specialised handler
- **Parallelisation**: several calls at once, then combine
- **Orchestrator–workers**: one model splits the task, others execute
- **Evaluator–optimiser**: one generates, one scores, loop to improve

**One-line answer**:
> "An agent is an LLM using tools in a loop. In production, start with the simplest design: use a
> workflow where you can, because the more autonomous it is, the harder it is to test and audit."

**Link to this project**: a **workflow + one bounded tool loop**. The state machine is the
workflow; only in TRIAGED does the model choose tools itself (≤ 8 turns, then a self-check). It
also uses **routing** (inbox router: rent or maintenance?) and **evaluator–optimiser** (red-team
generator + judge).

**Likely follow-ups**:
- *"Biggest risk of agents?"* → unpredictable, hard to test, unbounded cost, dangerous actions.
  Controls: turn limits, tool allowlist, permission levels, self-checks, human approval.
- *"How do you stop an infinite loop?"* → max turns (8 here; `advanceJob` max 6 steps) + timeouts
  + cost caps.

---

## 2. Tool use / function calling ⭐⭐⭐

**What**: letting the model "call functions". The model doesn't execute anything; it outputs a
**tool name + JSON arguments**, and your code runs it.

**How**:
```
1. Send tool definitions (name, description, JSON Schema params) to the model
2. Model returns: { tool: "search_tradies", input: { trade: "plumbing", suburb: "Newtown" } }
3. Your code executes it and sends the result back
4. Model continues: another tool, or a final reply
```

**Designing good tools**:
- Descriptions say when to use it and when not to
- Strict parameter validation (types, ranges, enums)
- Return **structured errors** so the model can correct itself
- Few, focused tools — too many and the model picks wrong

**One-line answer**:
> "The model only says what to call; execution always belongs to code. So validation,
> permissions, idempotency and audit belong in the execution layer."

**Link to this project**: the `executeTool` gateway — Zod → permission level
(read/auto/approval) → idempotency key → audit row. `approval` tools (spending money) are **never
shown to the model**.

**Likely follow-ups**:
- *"Model invents arguments?"* → schema validation + business validation (a tradie id must come
  from `search_tradies` results).
- *"Tool call fails?"* → structured error for the model to retry; too many attempts or a system
  error → escalate.
- *"Structured output vs tool use?"* → structured output: the model returns data in a schema and
  code decides what to do; tool use: the model chooses the tool. Most steps here use structured
  output because it's more controllable.

---

## 3. RAG (retrieval-augmented generation) ⭐⭐⭐

**What**: the model doesn't know your private knowledge, so **retrieve relevant material first and
put it into the prompt**.

**How**:
```
Offline (indexing):
  documents → chunk (e.g. ~500 tokens) → embed into vectors → store in a vector DB

Online (answering):
  question → embed → find top-k most similar chunks → add to prompt → model answers (with citations)
```

**Advanced points** (bonus marks):
| Problem | Fix |
|---|---|
| Chunks too big/small | Split by meaning/paragraph, with overlap |
| Pure vector search misses exact terms (model numbers, IDs) | **Hybrid search**: BM25 keywords + vectors, fused |
| Results not precise enough | **Rerank**: rerank model reorders top-50, keep top-5 |
| Model makes things up | Answer only from retrieved text, cite sources, say "don't know" otherwise |
| How to evaluate | Retrieval: recall/hit rate; generation: faithfulness, relevance |

**RAG vs long context**: context windows keep growing, but RAG is still cheaper, faster,
updatable, and supports permission filtering.

**One-line answer**:
> "RAG solves 'the model doesn't know private or recent knowledge'. Quality depends mostly on
> retrieval — chunking, hybrid search, reranking — not on the generation step."

**Link to this project**:
- **Why not used**: everything the system needs is **structured** (jobs, properties, tenancies,
  tradies). Exact SQL beats semantic search. There's no "find the answer in lots of unstructured
  documents" need.
- **When I would use it**:
  1. Tenants asking tenancy-law questions (retrieve Tenancy Services / Healthy Homes guidance)
  2. Finding "how similar faults were fixed" in past jobs
  3. A PM asking "what problems has this property had in two years?"

**Likely follow-ups**:
- *"Nothing relevant retrieved?"* → similarity threshold; below it, say "don't know" or escalate.
- *"Multi-tenant RAG without leaks?"* → filter by organization_id (metadata filter), or pgvector + RLS.

---

## 4. Embeddings and vector databases ⭐⭐⭐

**What**:
- **Embedding**: turns text into a list of numbers (a vector, e.g. 1024 dimensions). **Similar
  meaning → nearby vectors.** "No hot water" and "water heater broken" land close together even
  with different words.
- **Vector database**: stores vectors and quickly finds "the N most similar".

**How**:
- Similarity: usually **cosine similarity** (same direction?)
- At scale you can't compare one by one, so use an **approximate nearest neighbour (ANN)** index;
  the most common is **HNSW** (a layered graph, trades a bit of accuracy for speed)

**Common choices**:
| Option | Notes |
|---|---|
| **pgvector** | Postgres extension; lives with business data; transactions and RLS |
| Pinecone | Fully managed |
| Qdrant / Weaviate / Milvus | Open-source dedicated vector DBs; strong at large scale |
| Elasticsearch / OpenSearch | If you already run search: keywords + vectors together |

**One-line answer**:
> "Embeddings make 'semantic similarity' a computable distance. At small-to-medium scale I'd pick
> pgvector: no extra system, and it keeps Postgres transactions and row-level security."

**Link to this project**: not used. If added, **pgvector** — the project is already Postgres + RLS
multi-tenant, so a vector table with `organization_id` is isolated by default.

**Likely follow-ups**:
- *"When do you need a dedicated vector DB?"* → hundreds of millions of vectors, high QPS, special tuning.
- *"Embedding model changes?"* → vectors from different models aren't compatible; re-embed everything.

---

## 5. LangChain / LangGraph ⭐⭐

**What**:
- **LangChain**: a component library for LLM apps — model calls, prompt templates, retrievers,
  loaders. "Lego bricks".
- **LangGraph**: a framework that orchestrates agents as a **graph**.

**LangGraph core concepts**:
| Concept | Meaning |
|---|---|
| State | Shared state passed between nodes (one object) |
| Node | A step (call a model, a tool, or code) |
| Edge | Connection between nodes; **conditional edges** choose by state |
| Checkpointer | Saves state after each step; resume after interruption, replay |
| `interrupt()` | Pause for human input (human-in-the-loop) |

**One-line answer**:
> "LangGraph suits flexible orchestration, multi-agent collaboration and fast prototyping. When the
> process is fixed, waits for days, and state must match business data, I prefer a state machine
> plus a durable execution engine."

**Link to this project** (prepare this well — see `docs/agent-design.md` §12):
- Why not:
  1. **Fixed business processes**, no runtime orchestration needed
  2. State belongs in **business tables**; a checkpoint store would be a second source of truth
  3. Waiting days, timers and retries are **durable-execution** problems → Inngest
  4. Approvals span days, multiple PMs and audits → approval **records**, not `interrupt()`
- Migration seam: any graph node could call `executeTool`, keeping permissions, idempotency and audit.

**Likely follow-ups**:
- *"Checkpoint vs your DB state?"* → a checkpoint is the framework's execution snapshot; here the
  state *is* the business data — dashboard, audit and agent read the same thing.

**Tip**: spend half a day on the official tutorial building a small agent with human approval, so
you can talk from experience.

---

## 6. Prompt engineering and context engineering ⭐⭐

**Prompt engineering**:
- **System prompt**: role, rules, boundaries
- **Few-shot**: a few examples to copy the format
- **Structured output**: constrain with JSON Schema
- **Chain of thought**: reason before answering (complex judgements)
- **XML tags**: separate instructions from data (`<untrusted_message>` here)

**Context engineering** — the newer, more important idea:
> Deciding what information the model sees at each step. Too little → mistakes; too much →
> distraction, slower, more expensive.

**Prompt caching**:
- Cache the **stable prefix** (system prompt, tool definitions); later calls only pay for what changes
- Cheaper (cache hits cost much less) and faster

**One-line answer**:
> "Good prompts are the baseline; context engineering matters more — give each step only what it
> needs to do that step."

**Link to this project**:
- Each step **rebuilds context from the DB** (job, property, tenancy, last 12 messages, past jobs)
  instead of accumulating a chat transcript
- Message composition gets a **fact list** only, so the model can't claim "it's arranged"
- Stable prefix is cached; cache hits are visible in the trace page

---

## 7. MCP (Model Context Protocol) ⭐⭐

**What**: an open protocol from Anthropic that **standardises how agents connect to tools and
data**. "USB-C for AI".

**How**:
- **MCP server**: exposes tools, resources and prompts
- **MCP client**: inside the agent, connects to servers and uses them
- Write a server once; any MCP-capable agent (Claude, IDEs, other apps) can use it

**One-line answer**:
> "MCP standardises tools: write a tool once and any agent can reuse it, without per-framework adapters."

**Link to this project**: planned next step — expose the `executeTool` gateway as an MCP server so
other agents (including Keyhook's) can use these tools **with the same permissions, idempotency
and audit**.

---

## 8. LLM evaluation (evals) ⭐⭐⭐

**Why**: LLM output is non-deterministic; one prompt change can fix one case and break three.
Without evals you ship on vibes.

**Methods**:
| Method | Good for |
|---|---|
| Rules/assertions | Exact checks: format, state, whether a tool was called |
| Golden set | Classification accuracy, etc. |
| **LLM-as-judge** | Hard-to-rule checks: tone, helpfulness, fabrication |
| Human review | Spot checks, calibrating the judge |
| Red teaming | Actively hunting holes (injection, over-reach) |

**Tools**: promptfoo, LangSmith, Langfuse, Braintrust, OpenAI Evals.

**One-line answer**:
> "Evals are unit tests for LLM apps. I run them on every prompt or model change, compare scores,
> and turn production mistakes into new test cases."

**Link to this project** (your strength — lead with it):
- 84 YAML scenarios on a real model; metrics: urgency/trade accuracy, escalation
  precision/recall, final state, **escalation reason**
- **Forbidden actions must be 0**
- Red team generates attacks + a judge scores them
- PM corrections → harvested into draft scenarios → human review → eval set
- Model choice backed by data: Kimi escalation precision 0.88 vs Claude 1.0

**Likely follow-ups**:
- *"Is LLM-as-judge reliable?"* → needs human calibration and a clear rubric; the judge here also
  sees the system's tool results, not just text.

---

## 9. Multi-agent systems ⭐

**What**: several agents dividing work, e.g. a planner, executors and a reviewer.

**Frameworks**: CrewAI (role-based teams), AutoGen (conversational), OpenAI Agents SDK (handoffs),
Claude Agent SDK.

**One-line answer**:
> "Multi-agent setups divide work but add coordination cost, more failure points and harder
> debugging. Use them only when the task truly needs different expertise or parallelism."

**Link to this project**: several agents (maintenance, arrears, portfolio monitor, ops analyst)
**share one platform** (tool gateway, audit, approvals, evals), handing off via the inbox router.
"Agents are thin, the platform is thick."

---

## 10. Memory ⭐

| Type | Meaning | Implementation |
|---|---|---|
| Short-term | Context of the current task | Conversation history, current state |
| Long-term | Knowledge kept across sessions | Database, vector store, summaries |

**One-line answer**:
> "Memory doesn't have to be a vector store. Structured business data is most reliable in a
> database; vector memory is for when you need semantic recall."

**Link to this project**: short-term = rebuilt from the DB each step; long-term = the database
itself (job history, monitor findings, PM corrections). No vector memory — no semantic recall
needed. Improvement: summarise long threads instead of keeping only the last 12 messages.

---

## 11. Prompt vs RAG vs fine-tuning ⭐⭐

| Approach | Solves | Cost |
|---|---|---|
| Prompt changes | Behaviour, format, rules | Lowest — try first |
| RAG | Model **lacks knowledge** (private, recent) | Medium |
| Fine-tuning | Fixed **style/format**, narrow tasks, lower latency/cost | High; needs lots of good data |

**One-line answer**:
> "Prompt first; add RAG for missing knowledge; fine-tune only when prompt and RAG can't do it and
> you have plenty of data. Knowledge → RAG, behaviour → fine-tuning."

---

## 12. LLM security (OWASP LLM Top 10) ⭐⭐

Key items:
| Risk | Meaning | Control here |
|---|---|---|
| Prompt injection | Instructions hidden in input hijack the model | `<untrusted_message>` wrapping + injection flag → escalate |
| Sensitive data disclosure | Model reveals data it shouldn't | RLS multi-tenancy; Sentry scrubbing; data-class routing |
| Excessive agency | Agent has too much power | Tool allowlist + permission levels + hidden approval tools |
| Insecure output handling | Executing model output directly | Zod validation; the model never runs code |
| Unbounded consumption | Runaway cost/resources | Daily budget, rate limits, max turns |

**One-line answer**:
> "The best defence isn't making the model more obedient; it's making sure that even if it's fooled
> it can't do anything dangerous — least privilege, code decides, human approval."

---

## 13. Model fundamentals ⭐

| Concept | One line |
|---|---|
| Token | The unit models process; billing and context length are in tokens |
| Temperature | Randomness; lower = more stable (use low for classification/extraction) |
| Context window | Max tokens the model can see at once |
| Hallucination | Confidently made-up content; the model predicts plausible next words, it doesn't look up facts |
| Stop reason | Why it stopped: finished / hit max length / tool call / refusal |
| Latency | Time to first token + generation time; streaming improves UX |

---

## Appendix: one-week study plan

| Day | Topic | Outcome |
|---|---|---|
| 1 | Anthropic *Building Effective Agents* + tool-use docs | Explain workflow vs agent |
| 2–3 | Build a small RAG: pgvector + embeddings + retrieval + generation (~100 lines) | Explain chunking, hybrid search, rerank |
| 4 | LangGraph tutorial: a small agent with human approval | Compare LangGraph vs state machine + Inngest |
| 5 | MCP + prompt caching + eval methods | Explain LLM-as-judge limits |
| 6–7 | Practise "why X / why not Y" against this project | A 30-second answer per technology |

## Appendix: a universal answer frame

For any technology question:
1. **What problem it solves** (one line)
2. **How it works** (core idea)
3. **Costs / limits**
4. **Why my project uses it or doesn't**
5. **What would change my choice**

> Interviewers don't want "how many frameworks you've used"; they want "you know what each one
> solves and can justify your choices".
