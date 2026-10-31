# 示例项目：一个电商客服 Agent 串起所有技术 · Example Project: One E-commerce Support Agent That Uses Every Technology

> 中英写在一起，没有单独的 `.zh-CN.md`。Chinese and English together; no separate `.zh-CN.md`.
>
> **为什么另举例子？** Keyhook 刻意没用 LangGraph、RAG、Skills 等技术。为了面试时能讲清这些技术，这里虚构一个项目 **ShopAssist**，每个技术只讲三件事：**是什么 · 用在哪 · 为什么**。数字都是假设。
> **Why another example?** Keyhook deliberately doesn't use LangGraph, RAG, Skills and so on. To explain them in interviews, here is a fictional project, **ShopAssist**. Each technology answers three things: **what it is · where it's used · why**. All numbers are made up.

---

## 速记：要讲的 10 个知识点 · Cheat sheet: 10 points to say

| # | 关键词 · Keyword | 记住这句 · Remember this |
|---|---|---|
| 1 | **多 Agent + LangGraph** | 路由分给售前/订单/售后专家；每步存档，可暂停再续 · Router → specialists; every step saved, pause and resume |
| 2 | **Temporal** | LangGraph 管对话，Temporal 管几天后办完的事 · LangGraph for chat, Temporal for work that finishes days later |
| 3 | **工具三级权限** | read / auto / approval；模型只提议，代码执行 · Model proposes, code executes |
| 4 | **MCP** | 连工具的标准接口；权限和审计靠自己的网关 · Standard tool plug; permissions and audit in our gateway |
| 5 | **知识按量放** | 政策几页 → prompt + 缓存；说明书、工单海量 → RAG · Few pages → cached prompt; huge corpora → RAG |
| 6 | **记忆三种** | 短期对话、长期画像、语义相似案例 · Short-term chat, long-term profile, semantic cases |
| 7 | **LLM 网关** | 按难度选模型、缓存、故障切换、控成本 · Route by difficulty, cache, fail over, control cost |
| 8 | **人在回路** | ¥500 以上退款暂停等主管批 · Refunds over ¥500 pause for a supervisor |
| 9 | **幂等** | 退款带幂等键，重试不退两次 · Idempotency key: retries never refund twice |
| 10 | **安全 + 评测** | 消息不可信、脱敏、引用原文；场景 → 评委 → 红队 → 5% A/B · Untrusted input, redaction, citations; scenarios → judge → red team → 5% A/B |

> 一句话记住 · One line：**LangGraph 聊，Temporal 办，工具要权限，知识按量放，底线全都有。LangGraph talks, Temporal finishes, tools need permissions, knowledge by size, baseline always.**

---

## 0. 一分钟总结 · One-minute summary

| | 中文 | English |
|---|---|---|
| **做什么 · What** | 电商 AI 客服：答产品问题、查订单、办退换货，70% 自动闭环，难的转人工，大额退款等主管批 | AI support for an online store: product questions, order tracking, returns; 70% resolved automatically, hard cases go to staff, large refunds wait for a supervisor |
| **架构 · Architecture** | 渠道 → LangGraph 多 Agent 对话 → Temporal 长流程 → MCP 工具网关 + 知识（政策放 prompt，说明书/工单用 RAG）+ 记忆 → LLM 网关 | Channels → LangGraph multi-agent chat → Temporal long-running flows → MCP tool gateway + knowledge (policy in the prompt, RAG for manuals/tickets) + memory → LLM gateway |
| **技术 · Tech** | LangGraph、Temporal、MCP、长上下文 + Prompt 缓存、RAG（pgvector + 重排序）、长期记忆、LLM 网关（路由/缓存/降级）、结构化输出、微调、护栏、Agent SDK + Skills、Computer Use、A2A、追踪与评测 | LangGraph, Temporal, MCP, long context + prompt caching, RAG (pgvector + reranking), long-term memory, LLM gateway (routing/caching/failover), structured output, fine-tuning, guardrails, Agent SDK + Skills, Computer Use, A2A, tracing and evals |
| **亮点 · Highlights** | 对话用图（灵活），流程用 Temporal（可靠）；有副作用的操作都经网关，带权限、幂等、审计；人在回路可暂停再续 | Graphs for chat (flexible), Temporal for processes (reliable); every side effect goes through a gateway with permissions, idempotency and audit; human-in-the-loop pauses and resumes |

🇨🇳 **30 秒讲法**：ShopAssist 是电商 AI 客服。LangGraph 管对话，路由给售前、订单、售后三个专家 Agent；退货这种要等几天的事交给 Temporal；查订单、退款走 MCP 工具网关，带权限和幂等；退货政策直接放在 prompt 里并缓存；大额退款暂停等主管批。
🇬🇧 **30-second version**: ShopAssist is AI support for an online store. LangGraph runs the conversation and routes to pre-sales, orders and after-sales agents; work that waits days, like returns, goes to Temporal; orders and refunds go through an MCP tool gateway with permissions and idempotency; the return policy sits in the cached prompt; large refunds pause for a supervisor.

---

## 1. 项目是什么 · What the project is

🇨🇳 **ShopAssist**：一家卖电子产品的电商公司的 AI 客服。每天 5 万条咨询、2000 件商品、几页退货政策、几百页说明书；目标是 70% 由 AI 闭环解决。
🇬🇧 **ShopAssist**: AI customer support for an online electronics retailer. 50,000 enquiries a day, 2,000 products, a few pages of return policy, hundreds of pages of manuals; goal: 70% resolved by the AI end to end.

| 角色 · Role | 需求 · Needs |
|---|---|
| 顾客 · Customers | 问产品、查订单、退换货 · Ask about products, track orders, return or exchange |
| 人工客服 · Support staff | 只接 AI 搞不定的 · Only take what the AI can't handle |
| 主管 · Supervisors | 批大额退款 · Approve large refunds |
| 运营 · Ops team | 想知道"退货率为什么涨了" · Want to know "why did returns go up?" |

---

## 2. 架构（从上到下）· Architecture (top to bottom)

```
渠道 Channels      网站 web · App · 微信 WeChat
   ↓
对话层 Conversation  LangGraph：路由 Agent router → 售前 pre-sales / 订单 orders / 售后 after-sales → 转人工 handoff
   ↓ 要等几天的事 work that waits days（退货 returns）
流程层 Process       Temporal：等寄回 wait for parcel → 质检 inspect → 退款 refund
   ↓
工具层 Tools         MCP Servers（订单 orders · 物流 shipping · 支付 payments）+ 权限 / 幂等 / 审计网关 gateway
知识层 Knowledge     政策 policy：放 prompt + 缓存 in prompt + cached
                     说明书/工单 manuals/tickets：RAG（pgvector + 关键词 keyword + 重排序 reranking）
记忆层 Memory        用户画像 profile + 对话摘要 summaries
模型层 Models        LLM 网关 gateway：路由 routing · 缓存 caching · 降级 failover · 预算 budgets

旁路 On the side：运营分析 Agent ops analyst（Agent SDK + Skills + 沙箱 sandbox）
                 供应商门户 Agent supplier portal（Computer Use）
                 物流公司 Agent courier's agent（A2A）
```

---

## 3. 一个请求走一遍 · One request, step by step

顾客 · Customer：**"上周买的耳机左边没声音了，能退吗？" · "The headphones I bought last week have no sound on the left. Can I return them?"**

| 步 · Step | 发生什么 · What happens | 技术 · Technology |
|---|---|---|
| 1 | 检查注入，遮掉手机号 · Check for injection, mask the phone number | 护栏、脱敏 · Guardrails, PII redaction |
| 2 | 意图 = 退货，交给售后 Agent · Intent = return → after-sales agent | 多 Agent、微调小模型 · Multi-agent, fine-tuned small model |
| 3 | 读到是 VIP，喜欢换货 · A VIP who prefers exchanges | 长期记忆 · Long-term memory |
| 4 | 查订单：7 天前签收，¥899 · Order: delivered 7 days ago, ¥899 | 工具调用、MCP · Tool calling, MCP |
| 5 | 对照 prompt 里的退货政策：15 天内质量问题可退 · Check the policy in the prompt: faulty within 15 days can be returned | 长上下文 + Prompt 缓存 · Long context + prompt caching |
| 6 | ¥899 > 上限 ¥500 → 暂停等主管 · Over the ¥500 limit → pause for a supervisor | 人在回路 · Human in the loop |
| 7 | 主管批准 → 从断点继续 · Approved → resume from the same point | LangGraph checkpoint |
| 8 | 启动退货，等 7 天寄回 → 退款 · Start return, wait 7 days → refund | Temporal、幂等 · idempotency |
| 9 | 全程记录每次调用 · Every call recorded | 追踪、审计 · Tracing, audit |

🇨🇳 **完整过程**：消息进来先过护栏，检查有没有注入，把手机号遮掉。路由用微调小模型判断意图是"退货"，交给售后 Agent。售后 Agent 先读长期记忆，知道这是 VIP、以前喜欢换货；再通过 MCP 调订单工具，查到 7 天前签收、金额 ¥899；然后对照 prompt 里的退货政策（政策只有几页，直接放在 prompt 开头并缓存，不用检索），确认 15 天内质量问题可退。因为 ¥899 超过自动退款上限 ¥500，流程在这里暂停，等主管审批；LangGraph 把状态存进 checkpoint，主管批准后从断点继续。接着交给 Temporal 启动退货流程，等顾客 7 天内寄回、质检通过后再退款，退款带幂等键，重试也不会退两次。整个过程每次模型和工具调用都有追踪和审计记录。
🇬🇧 **The whole flow**: The message first passes guardrails, which check for injection and mask the phone number. The router, a fine-tuned small model, classifies the intent as "return" and hands it to the after-sales agent. That agent reads long-term memory (a VIP who prefers exchanges), calls the order tool through MCP (delivered 7 days ago, ¥899), and checks the return policy already in its prompt (faulty items can be returned within 15 days); the policy is only a few pages, so it sits at the start of the prompt and is cached instead of retrieved. Because ¥899 is over the ¥500 auto-refund limit, the flow pauses for a supervisor; LangGraph saves the state in a checkpoint and resumes from the same point once approved. Temporal then runs the return: it waits up to 7 days for the parcel, inspects it, and refunds with an idempotency key so a retry never refunds twice. Every model and tool call along the way is traced and audited.

---

## 4. 每个技术一句话 · Each technology in one line

### 模型层 · Models

🇨🇳 所有模型调用都经过一个 LLM 网关。网关按任务难度选模型：意图分类这种简单任务用便宜的小模型，写回复、做判断用大模型；主模型出故障时自动切到备用模型，并统一记录成本。系统提示词和工具定义每次都一样，所以做了 Prompt 缓存。模型输出要求是 JSON，代码先校验再用，格式不对就转人工。只有意图分类这种每天几万次的固定任务才做微调，其他都靠 prompt。
🇬🇧 Every model call goes through an LLM gateway. It picks the model by difficulty: a cheap small model for intent classification, a large one for replies and decisions. If the main model fails, it switches to a backup, and it tracks cost in one place. The system prompt and tool definitions are the same every time, so they are cached. Outputs must be JSON, which code validates before use; anything invalid goes to a human. Only intent classification, a fixed task run tens of thousands of times a day, is fine-tuned; everything else relies on prompts.
| 技术 · Tech | 是什么 · What | 这里怎么用 · Used for | 为什么 · Why |
|---|---|---|---|
| **LLM 网关 · LLM gateway** | 所有模型调用的统一入口 · One entry point for model calls | 简单任务小模型，难的大模型；挂了切备用 · Small for easy, large for hard; switch on outage | 统一控成本和故障 · One place for cost and failures |
| **Prompt 缓存 · Prompt caching** | 固定开头缓存起来 · Cache the fixed start | 系统提示词 + 工具定义 · System prompt + tools | 省钱、更快 · Cheaper, faster |
| **结构化输出 · Structured output** | 按 JSON 格式回答 · Answer in a JSON shape | `{intent, confidence}`，失败转人工 · invalid → human | 代码能可靠地用 · Code can rely on it |
| **微调 · Fine-tuning** | 用自己的数据再训练 · Train further on own data | 只用于意图分类（30 类）· Intent classification only (30 classes) | 高频固定任务才值得 · Only for high-volume fixed tasks |

> 口诀 · Rule：**少量知识放 prompt 缓存，海量知识用 RAG，高频固定才微调。Little knowledge in the cached prompt, huge corpora in RAG, fine-tune only high-volume fixed tasks.**

### 编排层 · Orchestration

🇨🇳 编排分两层。对话层用 LangGraph：一个路由 Agent 判断意图，再交给售前、订单、售后三个专家 Agent，每个专家只带自己需要的工具。LangGraph 每一步都自动存档，所以顾客中途换话题、或者需要暂停等人审批，都能从断点继续。要等几天的事，比如退货要等寄回、质检、退款，交给 Temporal。它保证流程即使服务器重启也能接着跑完。
🇬🇧 Orchestration has two layers. The conversation layer uses LangGraph: a router agent classifies the intent and hands off to pre-sales, orders or after-sales specialists, each with only the tools it needs. LangGraph saves every step, so when the customer changes topic or the flow pauses for approval, it resumes from the same point. Work that takes days, like a return that waits for the parcel, inspection and refund, goes to Temporal, which guarantees it finishes even if servers restart.
| 技术 · Tech | 是什么 · What | 这里怎么用 · Used for | 为什么 · Why |
|---|---|---|---|
| **LangGraph** | 把流程画成图来跑，每步自动存档 · Runs a flow as a graph, saving each step | 路由 → 专家 Agent → 输出 · Router → specialists → output | 对话开放，顾客会换话题 · Open conversations, topics change |
| **多 Agent · Multi-agent** | 一个总调度 + 多个专家 · One dispatcher + specialists | 路由 + 售前 / 订单 / 售后 · Router + three specialists | 更专、工具更少 · Focused, fewer tools |
| **Temporal** | 能等几天、保证做完的流程引擎 · Waits days, always finishes | 退货：等 7 天 → 质检 → 退款 · Returns: wait → inspect → refund | 服务器会重启，流程不能丢 · Servers restart; can't lose the process |

LangGraph 5 个词 · in 5 words：**State** 共享状态 shared data · **Node** 一步 a step · **条件边 conditional edge** 下一步去哪 where next · **Checkpointer** 存档 save · **interrupt** 暂停等人 pause for a human

> 口诀 · Rule：**LangGraph 管"这段对话怎么聊"，Temporal 管"这件事几天后办完"。LangGraph runs the conversation; Temporal runs what finishes days later.**

### 工具层 · Tools

🇨🇳 模型自己不执行任何操作，它只提议"调哪个工具、传什么参数"，由代码执行。每个工具有三级权限：只读的直接执行，低风险的自动执行，高风险的要人审批。比如 ¥500 以下的退款自动做，超过的要主管批，而且审批类工具模型根本看不到。订单、物流、支付各做成一个 MCP Server，几个 Agent 共用；每个 Agent 只加载自己需要的工具。权限、幂等和审计由我们自己的网关负责，MCP 只负责连接。
🇬🇧 The model never executes anything itself. It only proposes which tool to call with what arguments, and code runs it. Every tool has one of three permission levels: read-only runs directly, low-risk runs automatically, and high-risk needs human approval. Refunds under ¥500 are automatic; larger ones need a supervisor, and the model can't even see approval-level tools. Orders, shipping and payments are each an MCP server shared by the agents, and each agent loads only the tools it needs. Our own gateway handles permissions, idempotency and audit; MCP only handles the connection.
| 技术 · Tech | 是什么 · What | 这里怎么用 · Used for | 为什么 · Why |
|---|---|---|---|
| **Tool calling** | 模型说调哪个，代码执行 · Model picks, code runs | 查订单、建退货单、退款 · Orders, returns, refunds | 模型只提议 · Model only proposes |
| **三级权限 · 3 permission levels** | read / auto / approval | ¥500 以下自动退；以上要审批，模型看不到 · Under ¥500 auto; above needs approval, hidden from model | 防越权 · Prevent over-reach |
| **MCP** | 连接工具的标准协议（AI 的 USB-C）· Standard tool protocol ("USB-C for AI") | 订单、物流、支付各一个 Server · One server per system | 多个 Agent 共用工具 · Agents share tools |
| **按需加载 · Load on demand** | 每个 Agent 只给需要的 · Each agent gets only what it needs | 60 个工具，订单 Agent 只看 8 个 · 60 tools; orders agent sees 8 | 太多会选错 · Too many → wrong picks |

> 注意 · Note：**MCP 只管"怎么接"，权限和审计要自己的网关做。MCP only connects; permissions and audit need your own gateway.**

### 知识层 · Knowledge

🇨🇳 知识按量分两种放法。退货、保修这些政策只有几页，几乎每次都要用，就直接放在 prompt 开头并做 Prompt 缓存：命中缓存后比每次检索还便宜，也不会因为切块或检索漏掉条款。2000 个商品的说明书和几十万条历史工单太多，每次只用到一小部分，才用 RAG。文档先切成约 500 token 一段，转成向量存进 pgvector。检索时同时用向量（按意思）和关键词（按字面）：耳机型号这种编号必须精确匹配，只靠向量会搜不准。搜出 50 条后再重排序，挑最相关的 5 条给模型。检索本身也做成工具，复杂问题 Agent 可以自己决定搜几次。
🇬🇧 Knowledge is handled two ways, by size. Return and warranty policies are only a few pages and needed on almost every call, so they sit at the start of the prompt with prompt caching: a cache hit is cheaper than retrieving every time, and no clause is lost to chunking or a missed search. Manuals for 2,000 products and hundreds of thousands of past tickets are too large and only a small part is needed each time, so they use RAG. Documents are split into ~500-token chunks, embedded and stored in pgvector. Search combines vectors (meaning) and keywords (exact text), because product codes need exact matches that vectors miss. The top 50 results are reranked down to the 5 most relevant. Search is also a tool, so for hard questions the agent decides how many times to search.
| 技术 · Tech | 是什么 · What | 这里怎么用 · Used for | 为什么 · Why |
|---|---|---|---|
| **长上下文 + 缓存 · Long context + caching** | 整份放进 prompt，缓存起来 · Whole document in the prompt, cached | 退货、保修政策（几页）· Return and warranty policy (a few pages) | 更便宜、不漏条款、更简单 · Cheaper, nothing missed, simpler |
| **RAG** | 先检索再回答 · Retrieve, then answer | 说明书、历史工单 · Manuals, past tickets | 资料多、每次只用一点 · Huge; only a little needed each time |
| **切块 + 向量 · Chunks + vectors** | 文档切段转成向量 · Split and embed documents | 约 500 token 一段，存 pgvector · ~500-token chunks in pgvector | 按意思搜 · Search by meaning |
| **混合检索 · Hybrid search** | 向量（意思）+ 关键词（字面）· Vectors + keywords | 型号"WH-1000XM5"要精确匹配 · Exact model numbers | 向量搜不准型号 · Vectors miss exact codes |
| **重排序 · Reranking** | 再挑最相关的 · Pick the most relevant | 50 条挑 5 条 · Top 5 of 50 | 更准 · More accurate |
| **Agentic RAG** | 检索变成工具，自己决定搜几次 · Search as a tool | 搜说明书、工单 · Manuals, tickets | 复杂问题要多次搜 · Hard questions need several searches |

> 口诀 · Rule：**资料少直接放上下文；多、常变、要过滤才用 RAG。Little material → context; lots, changing, filtered → RAG.**
>
> 算笔账 · The maths：2 万 token 政策命中缓存 ≈ $0.004/次；RAG 每次 2 千 token 不能缓存 ≈ $0.008/次（按输入 $4/M、缓存读 $0.2/M）。20k cached tokens ≈ $0.004 a call; 2k uncached RAG tokens ≈ $0.008 (at $4/M input, $0.2/M cache read).

### 记忆 · Memory

🇨🇳 记忆分三种。短期记忆是这次对话，存在 LangGraph 的 checkpoint 里。长期记忆是会员等级、偏好和以前对话的摘要，存在 Postgres，下次来能接着用，比如知道这位顾客喜欢换货。语义记忆是以前类似问题怎么解决的，用向量检索。对话太长时，把前面的内容压缩成摘要，控制上下文长度。
🇬🇧 There are three kinds of memory. Short-term memory is this conversation, kept in LangGraph checkpoints. Long-term memory is the membership tier, preferences and summaries of past chats, stored in Postgres so the next visit can use them, for example knowing the customer prefers exchanges. Semantic memory is how similar issues were solved before, found by vector search. When a chat gets too long, the early part is compressed into a summary to keep the context small.
| 类型 · Type | 存什么 · What | 存在哪 · Where |
|---|---|---|
| 短期 · Short term | 这次对话 · This conversation | LangGraph checkpoint |
| 长期 · Long term | 会员等级、偏好、历史摘要 · Tier, preferences, summaries | Postgres |
| 语义 · Semantic | 类似问题以前怎么解决 · How similar issues were solved | pgvector |

对话太长 → 早期内容压成摘要（Compaction）。Too long → compress the early part into a summary (compaction).

### 运营分析 Agent（开放式任务）· Ops analyst agent (open-ended work)
🇨🇳 运营问"上个月退货率为什么涨了？"，这种问题没有固定步骤，所以不用状态机，而是用 Agent SDK 让 Agent 自己决定查什么、算什么。它写的 SQL 和分析代码在沙箱里跑：没有网络、只读数据库账号、有时间上限；Hooks 在执行前拦掉 DELETE、UPDATE。三个类目派给子 Agent 并行分析，只带回结论。报告格式和分析方法写成 Skill，用到时才加载。
🇬🇧 Ops asks "why did returns go up last month?". This has no fixed steps, so instead of a state machine the Agent SDK lets the agent decide what to query and compute. Its SQL and analysis code run in a sandbox with no network, a read-only database account and a time limit; hooks block DELETE and UPDATE before they run. Three product categories go to subagents in parallel, which return only conclusions. The report format and analysis method are written as skills, loaded only when needed.

| 技术 · Tech | 是什么 · What | 这里怎么用 · Used for |
|---|---|---|
| **Agent SDK / Harness** | 现成的 Agent 运行框架（Claude Code 同款）· Ready-made agent runtime | 自己决定查什么、算什么 · Decides what to query and compute |
| **沙箱 · Sandbox** | 隔离环境跑 AI 写的代码 · Isolated place for AI-written code | 无网络、只读账号、时间上限 · No network, read-only, time limits |
| **子 Agent · Subagents** | 派出去干子任务，只带回结论 · Subtasks, return conclusions only | 三个类目并行分析 · Three categories in parallel |
| **Hooks** | 动作前后自动检查 · Automatic checks around actions | 执行 SQL 前禁止 DELETE/UPDATE · Block DELETE/UPDATE |
| **Skills** | 操作手册，用到才加载 · A manual loaded when needed | 周报格式、退货率分析方法 · Report format, analysis method |

> 口诀 · Rule：**Tool 是螺丝刀，Skill 是说明书，MCP 是插座。A tool is the screwdriver, a skill the manual, MCP the socket.**

### 对外连接 · Outside connections

🇨🇳 有两类外部系统。物流公司自己也有 Agent，我们的 Agent 用 A2A 协议和它沟通，约上门取件。有个供应商门户是老网站，没有 API，就用 Computer Use 让模型看截图、点按钮来操作；因为容易出错，提交前一定要人确认。
🇬🇧 There are two kinds of outside systems. The courier has its own agent, and ours talks to it over the A2A protocol to book pickups. A supplier portal is an old website with no API, so Computer Use lets the model read screenshots and click through it; since that is error-prone, a human confirms before anything is submitted.
| 技术 · Tech | 是什么 · What | 这里怎么用 · Used for |
|---|---|---|
| **A2A** | Agent 和 Agent 之间的协议 · Protocol between agents | 和物流公司的 Agent 约取件 · Book pickups with the courier's agent |
| **Computer Use** | 模型看截图、点鼠标 · Model sees screens and clicks | 操作没有 API 的老网站，提交前人确认 · Old site with no API; human confirms |

> 口诀 · Rule：**MCP 连工具，A2A 连 Agent。MCP connects tools; A2A connects agents.**

### 安全、评测、运维 · Safety, evals, operations

🇨🇳 安全方面，顾客消息和检索到的文档都当作不可信数据，里面的指令一律不执行；输入先脱敏，工具只能查当前顾客的数据；回答政策问题必须引用原文，找不到就转人工，防止编造。评测从单元测试、RAG 检索评测，到 500 个对话场景、AI 评委打分、红队攻击，最后线上 5% 流量 A/B。运维上每段对话一条 trace，重点看解决率、转人工率和成本；Prompt 放在 git 里，改了要过评测，先放 5% 流量再全量。
🇬🇧 For safety, customer messages and retrieved documents are both untrusted data, and instructions inside them are never followed. Inputs are redacted, and tools can only read the current customer's data. Policy answers must quote the source; if nothing is found, the chat goes to a human instead of guessing. Evals run from unit tests and RAG retrieval checks to 500 conversation scenarios, an AI judge, red-team attacks and finally a 5% live A/B test. In operations, each chat is one trace, watched for resolution rate, handoff rate and cost. Prompts live in git, must pass evals when changed, and roll out to 5% of traffic before everyone.
| 方面 · Area | 做法 · What's done |
|---|---|
| **注入 · Injection** | 顾客消息当数据；检索内容也不可信（间接注入）· Messages are data; retrieved content is untrusted too |
| **隐私 · Privacy** | 输入脱敏；只能查当前顾客 · Redact; only the current customer's data |
| **幻觉 · Hallucination** | 必须引用政策原文，找不到转人工 · Must quote policy; nothing found → human |
| **人在回路 · HITL** | 短等用 `interrupt`，跨天用审批表 · Short waits `interrupt`; multi-day an approvals table |
| **评测 · Evals** | 单元测试 → RAG 评测 → 500 场景 → AI 评委 → 红队 → 线上 5% A/B · Unit → RAG → scenarios → AI judge → red team → 5% A/B |
| **可观测 · Observability** | 每段对话一条 trace；看解决率、转人工率、成本 · One trace per chat; resolution, handoff, cost |
| **发布 · Releases** | Prompt 放 git、过评测；先 5% 再全量 · Prompts in git, pass evals; 5% first |

---

## 5. 和 Keyhook 对比 · Compared with Keyhook

| 技术 · Tech | ShopAssist | Keyhook | 原因 · Why |
|---|---|---|---|
| LangGraph | 用 · Yes | 不用 · No | 对话开放 vs 流程固定 · Open vs fixed |
| 等几天 · Multi-day | Temporal | Inngest | 都需要，看团队选 · Both needed; pick by team |
| RAG | 用（说明书、工单）· Yes (manuals, tickets) | 不用 · No | 海量文档 vs 结构化数据 · Huge corpora vs structured data |
| MCP | 用 · Yes | 计划中 · Planned | 多 Agent 共用 vs 单一代码库 · Shared tools vs one codebase |
| Skills / Agent SDK | 用 · Yes | 不用 · No | 开放任务 vs 固定流程 · Open-ended vs fixed |
| 微调 · Fine-tuning | 用 · Yes | 不用 · No | 每天 5 万次 vs 量小 · High vs low volume |
| A2A / Computer Use | 用 · Yes | 不用 · No | 有无外部 Agent、老系统 · Outside agents, legacy systems |
| 权限 · 幂等 · 审计 · 护栏 · 评测 · 人在回路 · Permissions · idempotency · audit · guardrails · evals · HITL | 用 · Yes | 用 · Yes | **任何生产级 Agent 都要有 · Every production agent needs them** |

> 一句话 · One line：**架构看场景选，安全和质量底线永远要有。Pick the architecture for the case; the safety and quality baseline is always there.**

---

## 6. 系统设计题 8 步 · System design in 8 steps

| 步 · Step | 中文 | English |
|---|---|---|
| 1 | **问清需求**：谁用、做什么、涉及钱和安全吗、规模 | **Clarify**: users, tasks, money or safety, scale |
| 2 | **划人机边界**：可逆吗、影响大吗、有把握吗、谁负责 | **Human boundary**: reversible, impact, confidence, accountability |
| 3 | **选编排**：固定 → 状态机；开放 → LangGraph / SDK；等几天 → Temporal / Inngest | **Orchestration**: fixed → state machine; open → LangGraph / SDK; days → Temporal / Inngest |
| 4 | **设计工具**：权限 + 幂等 + 审计；共用就 MCP | **Tools**: permissions + idempotency + audit; MCP if shared |
| 5 | **知识**：结构化 → SQL；文档多 → RAG；少 → 放上下文 | **Knowledge**: structured → SQL; many docs → RAG; few → context |
| 6 | **安全**：注入、隐私、越权、幻觉 | **Security**: injection, privacy, over-reach, hallucination |
| 7 | **评测**：离线场景 + 红队 + 线上 A/B | **Evals**: offline scenarios + red team + live A/B |
| 8 | **运维**：追踪、成本、降级、灰度 | **Operations**: tracing, cost, failover, gradual rollout |

**30 秒总结 · 30-second summary**

🇨🇳 "我先划人机边界，再按任务选架构：固定流程用状态机，开放对话用 LangGraph，跨天流程用 Temporal 或 Inngest；资料少放 prompt 缓存，文档多用 RAG，结构化数据用 SQL。无论哪种，权限、幂等、审计、护栏、评测、人在回路都必须有。Keyhook 就是这样选了状态机 + Inngest，没用 LangGraph 和 RAG。"

🇬🇧 "I draw the human/agent boundary first, then pick the architecture for the task: a state machine for fixed processes, LangGraph for open conversations, Temporal or Inngest for multi-day work; the cached prompt for a little material, RAG for lots of documents, SQL for structured data. Whatever the choice, permissions, idempotency, audit, guardrails, evals and human in the loop are a must. That's how Keyhook ended up with a state machine plus Inngest, and no LangGraph or RAG."
