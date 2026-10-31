# 两个示例项目对比：ShopAssist vs AdReview · Two Example Projects Compared

> 中英写在一起。Chinese and English together.
> 详细内容 · Details：[ShopAssist 电商客服](interview-example-project.md) · [AdReview 广告审核](interview-ad-review-project.md)

---

## 0. 一句话 · In one line

| | ShopAssist | AdReview |
|---|---|---|
| **是什么 · What** | 电商 AI 客服，和顾客对话、办退货 · AI support that chats with customers and handles returns | 广告审核，判断视频/图片/文字是否违规 · Checks video, images and text for violations |
| **任务类型 · Task type** | **办事**：多轮对话 + 多步操作 · **Doing**: multi-turn chat + multi-step actions | **判断**：单次分类，输出标签 · **Judging**: one-shot classification with labels |
| **成功标准 · Success** | 问题解决了吗 · Was the issue resolved? | 判对了吗（准确率/召回率）· Was it judged right (precision/recall)? |

🇨🇳 一个是"Agent 去办事"，一个是"AI 做判断"。所以 ShopAssist 的难点在流程、工具和权限，AdReview 的难点在多模态、阈值和指标。但安全、审计、评测、人在回路这些底线两个都一样。
🇬🇧 One is "an agent that does things", the other is "AI that judges". ShopAssist's hard parts are process, tools and permissions; AdReview's are multimodal input, thresholds and metrics. The baseline of safety, audit, evals and human in the loop is the same for both.

---

## 1. 相同的地方 · What's the same

| 技术点 · Point | ShopAssist | AdReview |
|---|---|---|
| **结构化输出 · Structured output** | `{intent, confidence}` | `{decision, labels[], evidence, confidence}`，标签是枚举 · enum labels |
| **人在回路 · Human in the loop** | ¥500 以上退款等主管批 · Refunds over ¥500 wait for a supervisor | 低置信、高风险、申诉给人 · Low confidence, high risk, appeals |
| **长流程 · Durable workflow** | Temporal：等 7 天寄回 · wait 7 days for the parcel | Temporal：等人工几小时 · wait hours for a reviewer |
| **RAG** | 政策、说明书、工单 · Policies, manuals, tickets | 按行业取政策条款 + 相似案例 · Policy clauses by industry + similar cases |
| **幂等 · Idempotency** | 退款不退两次 · Never refund twice | 素材哈希 + 政策版本，不重复通知 · Hash + policy version, no double notices |
| **注入防护 · Injection** | 顾客消息不可信 · Customer messages untrusted | 广告文案不可信 · Ad copy untrusted |
| **防编造 · Anti-hallucination** | 必须引用政策原文 · Must quote the policy | 证据时间点/原文代码校验 · Code checks cited evidence |
| **成本 · Cost** | LLM 网关：小模型 + 缓存 · Gateway: small models + caching | 漏斗：只有 30% 用到大模型 + 缓存 · Funnel: only 30% reach the LLM + caching |
| **审计与追踪 · Audit and tracing** | 每次调用都记录 · Every call recorded | 记录模型、prompt、政策版本 · Model, prompt, policy versions |
| **评测 · Evals** | 场景 + AI 评委 + 红队 + A/B · Scenarios + judge + red team + A/B | 黄金集 + 按标签指标 + 红队 + 影子 · Golden set + per-label metrics + red team + shadow |

> 口诀 · Rule：**架构不同，底线相同。Different architectures, same baseline.**

---

## 2. 不同的地方 · What's different

| 方面 · Aspect | ShopAssist | AdReview | 为什么不同 · Why |
|---|---|---|---|
| **编排 · Orchestration** | LangGraph 多 Agent · multi-agent | 状态机 + 漏斗 · state machine + funnel | 对话开放 vs 流程固定 · Open chat vs fixed process |
| **输入 · Input** | 文字聊天 · Text chat | 视频、图片、文字 · Video, image, text | 需要抽帧、ASR、OCR · Needs frames, ASR, OCR |
| **工具调用 · Tool calling** | 核心：查订单、退款，三级权限、MCP · Core: orders, refunds, permissions, MCP | 几乎没有，只输出判断 · Almost none; it only outputs a verdict | 办事 vs 判断 · Doing vs judging |
| **模型 · Models** | 网关按难度路由 · Gateway routes by difficulty | 三层：规则 → 小模型 → 多模态大模型 · Rules → small models → multimodal LLM | 每天 20 万条，要先筛 · 200k a day, filter first |
| **微调 · Fine-tuning** | 意图分类做了微调 · Intent classifier fine-tuned | 不微调，用现成模型 + 相似案例 · None; off-the-shelf + similar cases | 意图固定 vs 政策常改 · Fixed intents vs changing policy |
| **记忆 · Memory** | 短期 + 长期 + 语义 · Short, long, semantic | 不需要，每条广告独立 · Not needed; each ad stands alone | 有用户 vs 无用户 · Users vs no users |
| **人的角色 · Human role** | 审批动作（批退款）· Approves actions | 复核判断（改标签）· Corrects judgements | 动作风险 vs 判断不确定 · Action risk vs uncertain verdict |
| **何时给人 · When to human** | 按金额和权限 · By amount and permission | 按置信度和标签风险 · By confidence and label risk | |
| **关键指标 · Key metric** | 解决率、转人工率 · Resolution, handoff rate | 每个标签的准确率/召回率 · Per-label precision/recall | |
| **回流 · Feedback** | 错误 → 新对话场景 · Mistakes → new scenarios | 人工改判 → 评测集 + 案例库 · Corrections → eval set + case library | |
| **延迟 · Latency** | 对话要秒级回复 · Seconds per reply | 图片 5 秒、视频 2 分钟 · 5 s image, 2 min video | |

---

## 3. 面试怎么用 · How to use it in an interview

🇨🇳 被问"你会怎么设计 X"时，先判断它是**办事**还是**判断**：
- 办事（客服、物业维修）→ 重点讲流程编排、工具权限、审批、幂等。
- 判断（审核、风控、分类）→ 重点讲漏斗、结构化标签、阈值、准确率/召回率。
- 两种都要讲：注入防护、证据/引用、审计、评测、人在回路。

🇬🇧 When asked "how would you design X", first decide whether it is **doing** or **judging**:
- Doing (support, maintenance) → focus on orchestration, tool permissions, approvals, idempotency.
- Judging (moderation, risk, classification) → focus on the funnel, structured labels, thresholds, precision/recall.
- Always cover: injection defence, evidence or citations, audit, evals, human in the loop.

**30 秒讲法 · 30-second version**

🇨🇳 "ShopAssist 和 AdReview 一个是办事、一个是判断。办事的用 LangGraph 编排对话，靠工具权限和审批控制风险；判断的用规则、小模型、大模型三层漏斗控制成本，靠固定标签和按标签的阈值控制质量。两者共用同一套底线：结构化输出、注入防护、证据校验、幂等、审计、评测和人在回路。Keyhook 偏办事，但流程固定，所以用状态机而不是 LangGraph。"

🇬🇧 "ShopAssist does things; AdReview judges. The doing one uses LangGraph to run the conversation and controls risk with tool permissions and approvals; the judging one controls cost with a rules → small model → LLM funnel and controls quality with fixed labels and per-label thresholds. Both share the same baseline: structured output, injection defence, evidence checks, idempotency, audit, evals and human in the loop. Keyhook is a doing agent, but its process is fixed, so it uses a state machine rather than LangGraph."
