[English](interview-guide.md) | 简体中文

# Keyhook-agent — 系统全景与面试指南（2026-10-29）

学习用：把整个系统从头到尾串成一条线，并把每部分背后的工程知识点整理成面试话术。细节见
[`spec.md`](spec.zh-CN.md)、[`architecture.md`](architecture.zh-CN.md)、
[`agent-design.md`](agent-design.zh-CN.md) 和 [`decisions.md`](decisions.zh-CN.md)。

---

## A 部分 — 系统

### A1. 30 秒介绍

> Keyhook-agent 把新西兰租客的一条维修请求（"没热水了"）从第一条消息一直处理到工单关闭：
> 分诊、找师傅、要报价、检查花费额度、约时间、追催无回复的人、确认修好、关单。只有需要判断
> 或授权时才拉物业经理（PM）进来。它是一个**事务型** agent（涉及钱、安全、别人的家），所以
> **可靠性放在代码里**——状态机、持久化工作流、工具网关——**模型只负责理解和撰写**。

面试金句：**"模型负责抽取和撰写，代码负责决策。"**（The model extracts and writes; code decides.）

### A2. 参与者

| 角色 | 做什么 |
|---|---|
| 租客 Tenant | 报修（可带照片）、回答问题、选时间、确认修好 |
| 师傅 / 供应商 Tradie | 报价、上门、报告追加工作（variation）和发票 |
| 业主 Owner | 授权超过额度的花费（v1 收通知，由 PM 代批） |
| 物业经理 PM | 监督：审批、处理升级、纠错、取消 |
| Agent | 中间所有协调工作 |

业务价值：一个工单 = 4 个人、3 个系统、约 9 个手工步骤。PM 从**干活**变成**监督**，一个 PM
能管更多物业。

### A3. 分层架构（模块化单体）

```
 客户端：PM 后台（服务端组件）· 租客/师傅模拟器 · 外部系统
     │
     ▼
 src/app        Next.js 路由和页面：会话鉴权、Zod 校验输入、withOrg() → Postgres RLS
     │  发事件
     ▼
 src/workflows  Inngest：job-advance（每个工单并发 1）、追催扫描（每 5 分钟）、
                欠租扫描、组合监控（每天）、媒体保留清理、onFailure → 升级
     │
     ▼
 src/agent      advanceJob：状态 → handler；每个 handler = 抽取 → 代码决策 → 撰写
                RoutingLlm：按步骤路由模型、超时、备用模型 + 熔断器
     │
     ▼
 src/tools      executeTool 网关：Zod · 权限（read/auto/approval）· 幂等 · 审计
     │
     ▼
 src/domain     业务规则 + 按组织隔离的数据访问 —— 访问数据库的唯一通道
     │
     ▼
 src/db         Postgres：每行都有 organization_id、复合外键、RLS、只追加的 audit_log
 src/adapters   消息适配器（开发环境用 mock outbox，不发真短信/邮件）
```

为什么是单体：一个团队、一次部署，模块之间通过接口通信。每个接口都是将来拆分的**接缝**
（消息网关、LLM 网关、媒体服务）——"绞杀者模式，不重写"。

### A4. 工单状态机（唯一事实来源）

```
RECEIVED → TRIAGED → NEEDS_INFO ⇄ TRIAGED
TRIAGED → AWAITING_QUOTE → AWAITING_APPROVAL → SCHEDULING   （在 PM 额度内则跳过审批）
SCHEDULING → SCHEDULED → IN_PROGRESS → AWAITING_CONFIRMATION → CLOSED
任意状态 → ESCALATED   （PM 可交还，但只能交还到离开时的那个状态）
任意状态 → CANCELLED   （仅 PM）           终态：CLOSED、CANCELLED
```

- 代码：`src/workflows/state-machine.ts` —— 每次写入都经过 `checkTransition()`；
  `allowedTransitions()` 是模型唯一能看到的"菜单"。
- `transitionJob` 对 `version` 列做**乐观锁**，并在同一事务里写审计行。
- 欠租有自己的状态机（`src/workflows/arrears-state-machine.ts`）：
  `OPEN → REMINDED ⇄ PROMISED → NOTICE_PENDING → NOTICE_SENT`，外加 ESCALATED / RESOLVED / CLOSED。

### A5. 一条请求的端到端流程

```
1. 租客："今天早上开始没热水"（+ 照片）
2. POST /api/v1/simulator/messages
     → ingestMessage（作为不可信内容存储，按组织隔离）→ 创建工单（RECEIVED）
     → 发 Inngest 事件 job.advance.requested
3. Inngest job-advance（并发键 = jobId，重试 3 次，onFailure → 升级）
     → advanceJob() 最多循环 6 步，直到必须等待某人
4. 有照片？视觉步骤 → 存储分析结果（先用代码做质量检查）
5. RECEIVED → 分诊 handler
     LLM 结构化抽取（紧急度、工种、置信度、promptInjection / legal 等标志）
     代码 decideTriage()：紧急 / 低置信 / 注入 / 法律 / 受伤 / 租客造成的损坏
       → ESCALATED，附升级包（摘要、已做的事、建议、证据）
     缺信息 → NEEDS_INFO + 追问
     否则 → TRIAGED + 回复租客已收到
6. TRIAGED → 唯一的工具循环（≤ 8 轮）：search_tradies → request_quote
     然后自检：状态真的变成 AWAITING_QUOTE 了吗？没有 → 升级
7. 安排追催行（催师傅）。advanceJob 返回；内存里不留任何东西。
   ── 过了几小时 / 几天 ──
8. 师傅回报价 → 新事件 → 报价 handler
     金额由代码解析（整数分）→ decideApproval()：
       ≤ 有效 PM 额度 → SCHEDULING
       ≤ 业主额度     → AWAITING_APPROVAL（PM 在后台审批；通知业主）
       > 业主额度     → ESCALATED
9. SCHEDULING → 给租客几个时段 → "选 2"（规则快速意图，不调 LLM）→ SCHEDULED
10. 师傅：到场 / 完工 → IN_PROGRESS → AWAITING_CONFIRMATION
11. 租客："修好了，谢谢" → CLOSED；通知业主最终费用；核对发票
    （差额 5% 或 NZ$50 以内 → 匹配，否则 PM 复核）
```

任何一步没人回：追催扫描器（cron 每 5 分钟）找出到期的行，每行发一个事件，handler 先**认领**
该行再行动，发追催；重试策略用完后改派师傅或升级。

### A6. 单个 handler 内部：抽取 → 决策 → 撰写

```
租客消息 ─► LLM：结构化抽取（Zod 校验）─┐
系统事实（工单、物业、租约、历史）──────┼─► 代码策略
                                         │   (decideTriage / decideApproval / decideReply)
                                         ▼
                           通过 executeTool 调工具（一个事务）
                                         ▼
                           LLM：只根据给定的事实清单撰写消息
```

- 模型从不说出状态名、从不算钱、从不选未提供的时段或师傅。
- 撰写时只给**事实**；规则：除非有事实支持，否则不能声称"已经安排好了"。

### A7. 工具网关 — `executeTool`（`src/tools/execute.ts`）

所有工具调用，无论来自模型还是代码，都走这一个函数：

1. **Zod 校验**输入 → 不合法时返回结构化错误，模型可以修正。
2. **权限级别** `read | auto | approval`。`approval` 工具会检查 `approvals` 表里是否有
   `status = approved` 的记录；它们**永远不暴露给模型**（`toAnthropicTool` 会抛错）。
3. **幂等**：key = `${idempotencyScope}:${tool}:${callIndex}`，scope = 工单版本 + 触发它的
   消息/追催。用 `withIdempotency` 在**保存点（savepoint）**里执行，key 和副作用一起提交或回滚；
   重放时返回已存结果；同一 key 但请求哈希不同 → `IDEMPOTENCY_MISMATCH`。
4. **每次调用写一行审计**（谁、做了什么、为什么、输入、输出、结果、trace id），表是只追加的
   （数据库触发器拒绝 UPDATE/DELETE）。

### A8. 人在回路（Human in the loop）

- **审批记录**（`approvals` 表）—— 能跨越几天、多个 PM、经得起审计。PM 点批准 →
  `recordApprovalDecision` → 以 PM 为执行者运行审批级工具 → 写审计。
- **升级包**：摘要、已做的事、建议动作、证据 → PM 约 30 秒就能决定。
- **交还**只能回到离开时的状态。**取消**只能由 PM 做。
- 判断"需要人"的**四个测试**：可逆性、影响（钱/法律/安全/住房）、置信度、问责归属。

### A9. 同一平台上的其他工作流

| 工作流 | 触发 | 人机边界 |
|---|---|---|
| 检查发现 → 工单（M8） | PM 通过 API 录入发现 | 同维修流程 |
| 组合监控 Portfolio Monitor（M8） | 每天新西兰时间 06:00 cron | 纯规则（同一物业 12 个月内同工种 ≥ 3 单）；只**提议**，PM 决定开单 |
| 追加工作和发票核对（M7） | 师傅消息 / 发票照片 | 新总额重新走审批策略 |
| 欠租 Arrears（M9） | 每日扫描，每个案件一个事件 | agent 提醒、记录还款承诺；正式 14 天通知是**固定模板**，PM 审批；仲裁庭 / 困难情况只能人处理 |
| 收件箱路由 | 有欠租案件的租客发来未关联工单的消息 | 区分是房租还是维修 |
| 运维分析 Ops analyst | 每周 | 代码发现问题；模型只负责排序 |

"Agent 要薄，平台要厚"：欠租功能只用了一个状态机、五个工具、一个策略函数和九个评测场景。

### A10. 模型层（`src/agent/providers/`）

- 一个 `LlmClient` 接口；默认 Claude；OpenAI / DeepSeek / Kimi 走 OpenAI 兼容适配器
  （支持则用 JSON schema 输出，否则 JSON 模式 + Zod）。
- **按步骤路由**，步骤组：`triage, retriage, act, interpret, compose, vision, route, ops`。
  优先级：评测覆盖 → 组织 `llm_routing` → 环境变量默认值 → Claude。
- **韧性**：按实测延迟设置每步超时；备用模型；**熔断器**（60 秒内失败 3 次 → 跳过 60 秒，
  半开时试一次）。超时/429/5xx/鉴权/余额不足会切换；拒答或答案不对**不**切换（换模型解决不了内容问题）。
- **每步有数据分级**：`personal` 步骤不能发给没有保障措施的境外供应商（新西兰隐私法 IPP 12）——
  配置错误时失败即关闭（fail closed），工单升级。
- 错误：拒答 / 无法解析 / 配置错误 → 立即升级，绝不猜测。

### A11. 质量闭环与可观测性

```
PM 标记错误 ─► agent_feedback ─► pnpm eval:harvest ─► 草稿场景（reviewed: false）
红队（pnpm redteam）──────────────────────────────────┘        │ 人工审核
                                                                ▼
                  evals/scenarios/*.yaml ─► pnpm eval / 夜间 CI ─► 改 prompt/策略/模型 ─► PR
```

- 测试：Vitest 单元测试 + 在真实 Postgres 上用脚本化假 LLM 跑的 DB 测试。
- 评测：约 84 个 YAML 场景；指标：紧急度/工种准确率、升级精确率/召回率、最终状态、回复语言、
  升级**原因**；**禁止动作必须为 0**。17 个场景的冒烟集约 1 美元。
- 可观测性：OpenTelemetry GenAI span → Langfuse；Sentry（已脱敏）；`llm_calls`（token、缓存、
  以美元微元计的成本、延迟）；每个工单的 "Agent trace" 页面；迁移未完成时 `/api/v1/health` 返回 503。
- 成本：Claude Opus 上每个场景约 0.06 美元、约 4 次调用；一个完整工单约 10 次调用。

---

## B 部分 — 面试知识点

每条：**概念 → 在本项目里的体现 → 面试时一句话怎么说。**

### B1. Agent 设计

| 概念 | 本项目 | 一句话 |
|---|---|---|
| Workflow vs Agent | 带 LLM 步骤的工作流；只有一个有界的工具循环 | "固定业务流程跑在状态机上，开放式任务才用 harness。" |
| 有界自主 | 只在 TRIAGED 有工具循环，≤ 8 轮，之后自检 | "自主权按动作授予，而不是按 agent 授予。" |
| 结构化输出 | `output_config.format` + Zod；不匹配 → `LlmOutputError` → 升级 | "不解析自由文本；校验，失败就升级。" |
| 幻觉控制 | 钱、状态、资格由代码算；撰写只用事实清单 | "代码负责的东西，模型编不出来。" |
| 任务分解 | 预先设计约 12 个状态，每个 1–2 次窄用途 LLM 调用 | "规划发生在设计时，不在运行时。" |
| 记忆 | 每步从 Postgres 重建上下文（工单、物业、最近 12 条消息）；不用向量库 | "记忆就是业务状态，不是聊天记录。" |
| 意图漏斗 | 第 1 层规则（`fast-intents.ts`）、第 2 层状态、第 3 层模型 | "先用最便宜且正确的一层；规则只匹配整条消息。" |
| Harness 工程 | 窄领域 harness：网关、路由、状态机、评测 | "模型周围的环境比用哪个框架更重要。" |
| 为什么不用 LangGraph / CrewAI | checkpoint 存储会成为第二个事实来源；等几天是持久化执行问题 | "我选了持久化执行 + 数据库状态，而不是图框架。" |
| MCP | 下一步：把 `executeTool` 暴露成 MCP server | "外部 agent 也走同样的权限和审计。" |

### B2. 安全

| 概念 | 本项目 | 一句话 |
|---|---|---|
| Prompt 注入 | `<untrusted_message>` 包裹、中和闭合标签、`promptInjection` 标志 → 升级且不发任何消息；图片中的文字同样处理 | "不可信内容只是数据；而且模型本来就碰不到危险工具。" |
| 最小权限 | 审批工具不暴露给模型；没有 shell、没有任意 HTTP | "纵深防御：能力、数据、输入、出站四层。" |
| 多租户 | 每行 `organization_id`、复合外键、Postgres **RLS**（`withOrg()` 里 `SET LOCAL ROLE keyhook_app`）；失败即关闭；表缺策略测试就失败 | "隔离由数据库强制，不只靠 WHERE 条件。" |
| 审计 | 只追加的 `audit_log`，触发器拒绝更新 | "agent 的每个动作事后都能解释。" |
| 隐私 / 数据驻留 | 每步数据分级；IPP 12 授权；Sentry 脱敏 | "路由配置按数据分级校验，配错即拒绝。" |
| 沙箱 | 不需要——不执行代码；如需要则用 Firecracker/gVisor、无网络、短期凭证 | "知道什么时候需要沙箱，什么时候只需要工具白名单。" |

### B3. 分布式系统与可靠性

| 概念 | 本项目 | 一句话 |
|---|---|---|
| 持久化执行 | Inngest：事件、重试、cron、`step.run` | "要等好几天的工作不能放内存里。" |
| 并发控制 | Inngest 并发键 = jobId（每个工单同时只跑一个） | "按实体串行，跨实体并行。" |
| 幂等 | key + 请求哈希与副作用同一事务；保存点；重放返回已存结果 | "至少一次投递 + 幂等副作用 = 效果上恰好一次。" |
| 乐观锁 | jobs 表的 `version` 列 | "不持锁也能发现丢失更新。" |
| 先认领再执行 | 追催行先认领再发催促 | "重复事件变得无害。" |
| 数据库是事实来源 | 扫描器从 `follow_ups` 重新算出到期工作；事件 id 去重 | "事件丢了，下一次扫描能补回来。" |
| 失败处理 | `onFailure` → 升级；区分永久错误和瞬时错误 | "工单绝不默默卡住，失败变成人的任务。" |
| 熔断器 | 关闭 / 打开 / 半开；目前按进程，规模化后放 Redis | "别再为一个挂掉的供应商付 60 秒超时。" |
| 事务性 Outbox（未来） | 其他服务需要消费工单事件时 | "提交和事件不会不一致。" |
| 短事务 | 绝不在数据库事务里调 LLM | "慢 I/O 先做，再在一个事务里落副作用。" |

### B4. 数据建模

- **金额用整数分（NZD）**——没有浮点误差；`assertCents`。
- **UTC 存储，Pacific/Auckland 显示**——夏令时安全。
- **约束放在数据库**：CHECK 约束、复合外键 `(organization_id, id)`、枚举与代码共用同一组 TS 常量生成。
- **审批策略**：`有效 PM 额度 = min(PM 额度 ?? 组织默认, 业主额度)`——PM 自动批准永远不会超过业主授权。
- **扩展计划**：`audit_log`、`messages`、`llm_calls` 按月分区；CDC 到数仓；后台读只读副本；
  大客户用独立 schema / 独立库。

### B5. LLM 评测与质量

- **三层**：确定性代码测试（假 LLM）→ 真模型场景评测 → 发现未知问题（红队 + PM 纠错）。
- **检查原因，不只检查结果**（`notReasons`）——原因错但结果对是潜在 bug。
- **人审核生成的测试**——红队/收割来的场景都以 `reviewed: false` 落地。
- **按评测分数 × 成本、按步骤选模型**。例如 Kimi 升级精确率 0.88 vs Claude 1.0——每次错误升级都耗
  PM 时间，便宜的 token 可能很贵。
- **发布门禁**：评测分数 + 禁止动作 = 0，作为 prompt/模型变更的必过检查。

### B6. 成本与性能

- 规则先于模型（快速意图）；稳定前缀做 prompt 缓存；`compose`/`interpret` 用同厂商更便宜的模型
  （评测通过后才换）；每步设置 effort；每日预算和模拟器限流；后台可看每单成本。
- 经济账：模型成本不到一个工单价值的 1%；真正贵的失败是错误/漏掉的升级和紧急情况下回复太慢。

### B7. 架构演进

- 模块化单体 → 沿接缝按顺序拆分：消息网关 → LLM 网关 → 媒体服务。
- 当数据驻留/私有网络/合同要求时 Vercel/Neon → AWS（先 ECS Fargate 再 EKS；Aurora 多可用区；
  媒体放 S3+KMS；通过 outbox 接 SQS/EventBridge；Terraform；蓝绿发布）。
- 高可用/容灾：≥ 2 个可用区、PITR、Aurora Global DB 到悉尼，RPO ≤ 5 分钟，RTO ≤ 1 小时。
- "每次迁移都要有触发条件，不因为大公司这么做就做。"

### B8. AI 辅助交付

- 独立的 PR 审查 agent + 安全审查 agent（`review.yml`），按改动路径分风险等级，人来合并。
  分阶段计划：直到 agent 实现 issue，人审批方案和结果。

---

## C 部分 — 常见问题与简答

1. **怎么防止 LLM 干危险的事？** 它根本够不着：状态机在代码里，审批工具对模型隐藏且需要已存审批记录，
   钱由代码算，每个输入都过 Zod，注入 → 升级。
2. **Inngest 重试了一个已经发过短信的步骤怎么办？** 幂等 key 和副作用在同一事务 → 重放返回已存结果，不会发第二条。
3. **同一工单两条消息同时到？** 并发键 = jobId 让它们串行；入站消息最多处理一次（第二次 `DuplicateInboundError` 中止）。
4. **模型返回乱码或拒答？** `LlmOutputError` / `LlmRefusalError` → 带原因升级；绝不盲目重试。
5. **供应商挂了？** 备用模型 + 熔断器；永久错误升级；紧急情况一定能到人。
6. **怎么知道 prompt 改动没退化？** 每次提交跑场景评测，禁止动作保持 0，PR 里附分数对比。
7. **为什么不用 LangGraph？** 状态应在领域表里；等几天是持久化执行问题；checkpoint 存储是第二个事实来源。
8. **多租户怎么隔离？** 每个事务设置受限角色的 RLS，加上显式组织过滤、复合外键，以及"表缺策略就失败"的测试。
9. **评测发现的最难的 bug？** 红队：agent 声称安排好了实际没有；租客说"先别派人"后仍继续；
   升级摘要写"已回复租客"其实什么都没发。用事实清单撰写修复，并保留为回归场景。
10. **下一步做什么？** 校验工具输出、长对话做摘要、按供应商的令牌桶限流、共享熔断状态、
    消息适配器后接真实渠道、把工具做成 MCP server。

### 需要记住的代码位置

| 主题 | 文件 |
|---|---|
| 状态机 | `src/workflows/state-machine.ts` |
| 编排循环 | `src/agent/advance.ts` |
| Inngest 函数 | `src/workflows/functions/job-advance.ts` |
| 工具网关 | `src/tools/execute.ts` |
| 幂等 | `src/domain/idempotency.ts` |
| 花费策略 | `src/domain/approval-policy.ts` |
| 升级规则 | `src/agent/policy.ts` |
| 注入包裹 | `src/agent/untrusted.ts` |
| 快速意图 | `src/agent/fast-intents.ts` |
| 故障切换 / 熔断 | `src/agent/providers/resilience.ts` |
| RLS | `src/db/org-scope.ts`，迁移 `0007_m5_row_level_security.sql` |
| 追催扫描器 | `src/workflows/functions/follow-ups.ts` |
