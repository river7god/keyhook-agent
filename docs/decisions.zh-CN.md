[English](decisions.md) | 简体中文

> 本文为 [`decisions.md`](decisions.md) 的中文译本，以英文版为准。

# 架构决策记录

最新的在最后。每条包含：日期、决策、理由。日期为新西兰本地时间。

---

### 2026-10-17 — 模块化单体 + API 优先，不做微服务
**决策：** 一个 Next.js 应用。业务规则放在 `src/domain/`，是所有调用方访问数据库的唯一路径：
看板页面、`/api/v1` 路由、agent 工具和 Inngest 函数。外部系统通过 `src/adapters/` 中的端口接入。
**理由：** 单人开发；核心保证（状态转换 + 审计行 + 幂等记录原子提交）依赖单个 Postgres 事务。
微服务会把它变成 saga/outbox，却没有产品收益。清晰的模块边界让日后拆分成本很低；Inngest worker
是最自然的第一个拆分对象。

### 2026-10-17 — 从第一天起就是多租户 SaaS；租户称为 `organization`
**决策：** 每张业务表都有 `organization_id NOT NULL`。子表使用复合外键 `(organization_id, x_id)`，
由数据库拒绝跨组织引用。domain 函数显式接收 `organizationId`。Postgres RLS 推迟到 M5，作为第二道防线。
**理由：** 事后补多租户要改动每张表、每个查询、每个测试。在这个领域里 "tenant" 已经指租客，
所以 SaaS 租户称为 *organization*（物业管理公司）。

### 2026-10-17 — 三级花费审批，带全局兜底
**决策：** `PM 有效额度 = min(property_managers.auto_approve_limit_cents ??
organizations.default_pm_auto_approve_limit_cents, owners.approval_limit_cents)`。
预估 ≤ 有效额度 → 自动通过；≤ 业主额度 → PM 审批；超出 → 升级。
实现在 `src/domain/approval-policy.ts`。
**理由：** PM 经验不同（按人设额度），组织需要默认值，且 PM 的自动审批永远不能超过业主授权
（`min` 上限）。

### 2026-10-17 — 超出 spec §9 的 schema 新增
**决策：** 新增 `organizations`、`property_managers`、`tenancy_tenants`（多对多）、
`idempotency_keys`、`jobs.source` / `created_by_*`（`reported_by_tenant_id` 可空）、
`jobs.state_before_escalation`、`jobs.version`。
**理由：** 多租户；合租者共享租约；工单可能来自 PM、巡检或 agent 自身；PM 需把升级"交还"到原状态；
状态转换需要乐观锁；规则 3 需要持久化保存幂等响应。

### 2026-10-17 — 工种枚举加 `other`，不加 `general`
**决策：** `plumbing | electrical | heating | handyman | locksmith | other`。
**理由：** `handyman` 本身就是综合维修工种；再加 `general` 会语义重叠，导致分诊在两者间摇摆。
`other` 是明确的"无法归类 → 交给 PM"出口。

### 2026-10-17 — 不变量在数据库层强制，而不仅在代码中
**决策：** 用 CHECK 约束和部分唯一索引保证：升级状态一致、外发消息必须有幂等键、每个工单只有一个
待审批项、每份租约只有一个主联系人、金额分非负、置信度在 0–1 之间。`audit_log` 通过触发器只允许追加
（拒绝 UPDATE/DELETE；TRUNCATE 仅供开发/测试使用——生产角色不得拥有 TRUNCATE 权限）。
**理由：** 即使应用代码有 bug 或有人直接用 SQL 控制台，规则 2–4 也必须成立。

### 2026-10-17 — 状态机在代码中；LLM 只能从菜单里选
**决策：** `src/workflows/state-machine.ts` 掌控所有转换。ESCALATED 可从任何非终止状态进入；
离开 ESCALATED 仅限 PM，且只能回到 `state_before_escalation`。CANCELLED 仅限 PM。CLOSED 和
CANCELLED 为终止状态。模型只会被提供 `allowedTransitions()`。2026-10-17 经产品负责人确认：
终止状态的工单不能升级；PM 不能从 ESCALATED 直接关单（只能交还或取消）；花费审批被拒绝后转为升级
（M2 实现）。
**理由：** CLAUDE.md 规则 1 / spec §5。

### 2026-10-17 — M0 无认证；PM 身份用明文字符串
**决策：** `approvals.decided_by` 和 `audit_log.actor_id` 为文本。页面以 `DEV_ORGANIZATION_SLUG`
指定的组织身份运行。
**理由：** 认证不在 v1 范围内；字符串 ID 日后迁移为用户外键很简单。

### 2026-10-17 — 工具链与版本
**决策：** Node 24 LTS、pnpm 10、Next 16、React 19、TypeScript 6（不用 7——typescript-eslint 只支持
< 6.1）、ESLint 9 flat config（不用 10——eslint-config-next 的插件尚不支持）、Vitest 5（分 `unit` 和
`db` 两个 project）、postgres.js 驱动、通过锁定版本的 `inngest-cli` 运行 Inngest 开发服务器。所有版本
精确锁定，且安装时已发布至少两周。Postgres 17 运行在 Docker 中，宿主端口 54329。
**理由：** lint 工具链兼容性；可复现的安装；DB 测试针对专用的 `keyhook_test` 数据库串行运行，每次从
迁移文件重建。

### 2026-10-17 — Playwright 推迟到 M2/M3
**决策：** M0 不引入 e2e 工具；`pnpm test:e2e` 随第一个真实 UI 流程一起加入。
**理由：** M0 的 UI 只是占位；目前单元测试 + DB 集成测试的信号更有价值。

### 2026-10-17 — 种子数据手写且确定性
**决策：** 固定 UUID（`src/db/seed/ids.ts`），不用 faker。另有一个只有一套房产的组织，用于测试隔离。
Harbour City 的 15 份租约 = 10 份当前 + 5 份已结束（历史）。
**理由：** 测试、评测和模拟器按名称引用固定数据；边界情况是刻意设计的。

### 2026-10-17 — 文档双语：英文为准，中文并列
**决策：** 每份文档都有英文 `X.md` 和简体中文 `X.zh-CN.md`，放在同一目录，首行互相链接。以英文版为准；
两个版本都更新后，改动才算完成。`CLAUDE.zh-CN.md` 是参考译本——Claude Code 加载的是 `CLAUDE.md`。
**理由：** 产品负责人使用中文工作；作品集的读者使用英文。

### 2026-10-17 — Agent 目录与人机边界
**决策：** `docs/agents.md` 按触发方式（被动响应 / 主动巡查 / 人工调用）× 自主度（只建议 / 需审批执行 /
自主执行）对 agent 分类，并通过工具权限级别细化到每个动作，同时给出各领域的自主度矩阵。维修以外的行在
确认前均为提议。
**理由：** 让路线图（下一个做资产组合监控，欠租作为第二个工作流）以及升级/审批规则有统一的参考依据。
