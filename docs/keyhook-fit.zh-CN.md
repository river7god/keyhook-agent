[English](keyhook-fit.md) | 简体中文

> 本文为 [`keyhook-fit.md`](keyhook-fit.md) 的中文译本，以英文版为准。

# Keyhook-agent × Keyhook —— 产品契合度（2026-10-18）

本文说明本项目与 Keyhook 现有平台的关系，依据是其公开官网（keyhook.com、/features、/pricing、/about，2026-10-18 读取）。
仅基于营销页面，不代表了解 Keyhook 的内部情况。本项目为独立项目。

## 1. Keyhook 现状（官网）

| | |
|---|---|
| 定位 | 面向物业经理的一体化物业管理平台——"the simplest and smartest way to run their entire business" |
| 公司 | 由 Luke 和 Aaron 在惠灵顿创立；奥克兰、惠灵顿、基督城设有办公室；"100% 本地支持" |
| 规模宣称 | 25,000+ 活跃用户；App 评分 4.9；管理工作量减少 "40%+" |
| 定价 | 按资产组合规模定制，不公开价目表 |
| 价值观 | Innovate, Don't Imitate · Stay Local · Product Delivery Is Everything · Relationships Are Everything |

模块：房源发布（Trade Me、RealEstate.co.nz、OneRoof、Homes.co.nz）· 租客筛查（信用、警方、法院、Tenancy Tribunal）·
文档与电子签名 · **巡检**（离线 App、照片/视频、语音笔记、巡检发现 → 维修工单）· **维修**（租客带照片/视频报修、供应商
管理、带预算阈值的业主审批、发票匹配工单）· 财务（银行流水、自动匹配、**自动催租提醒**、信托账户）· **合规**（RTA 与
Healthy Homes 模板、到期提醒、**不可篡改的审计日志**、押金监控）· 租客 / 业主 / 供应商门户（"AI-powered automated updates"）。

## 2. 招聘方向指向哪里

官网上的 "AI Powered" 功能更像辅助型自动化：自动回复、发票信息提取、流水匹配、定时提醒。而岗位要的是能"把维修问题从头推进到底"
的 agent。维修页面上，数据和审批都已具备，但中间这一段没有描述：

| 维修环节 | 官网已有 | 未描述 |
|---|---|---|
| 租客带照片/视频报修 | ✅ | |
| 带预算阈值的业主审批；在业主门户审批报价/变更 | ✅ | |
| 发票 ↔ 工单匹配 | ✅ | |
| 工单状态（New → In Progress → Complete） | ✅ | |
| 判断紧急程度、选择供应商 | | ❓ |
| 催报价、换人、协调上门时间 | | ❓ |
| 及时告知租客进展、确认修好 | | ❓ |
| 判断何时需要人介入 | | ❓ |

缺的这一段，正是 Keyhook-agent 在做的事。

## 3. 对应关系

| Keyhook 能力 | Keyhook-agent | 状态 |
|---|---|---|
| 业主审批 + 预算阈值 | 三级策略（PM 额度 → 业主额度 → 升级），由代码强制 | 已完成 |
| 不可篡改的审计日志 | 只追加的 `audit_log`（数据库触发器），记录每个 agent/PM 操作 | 已完成 |
| 租客 / 供应商门户 | 消息适配层（mock 发件箱；之后接门户） | 接口已就位 |
| 多物业公司 SaaS | 处处带 `organization_id` + Postgres RLS | 已完成 |
| 租客报修附带照片/视频 | 请求并分析媒体素材 | 已完成——照片（M6）；视频计划中 |
| 业主审批报价**变更** | 变更流程 | 已完成（M7） |
| 发票匹配工单 | 发票与已批准金额核对 | 已完成（M7）——文字和照片 |
| 巡检发现 → 维修工单 | `POST /api/v1/inspection-findings` + Portfolio 页面 | 已完成（M8） |
| 业主门户更新 | 审批、完工时通知业主 | 已完成（M7）——经发件箱 |
| 给租客的"AI 自动更新" | 关键节点主动告知租客 | 已完成（M7） |
| Healthy Homes / 到期提醒 | 资产组合监控 agent | 部分完成（M8）：重复故障；合规到期需要数据源 |
| 自动催租提醒 | 同一平台上的欠租工作流 | **计划中（R8）** |
| 房源、筛查、电子签名、信托账户、报表 | — | 不在范围：属于 Keyhook 平台本身，通过接口协作 |

## 4. 定位与面试要点

**一句话：** *The agent layer that moves a Keyhook work order from tenant request to closed — dispatching, chasing,
scheduling and confirming — and hands the property manager an escalation package only when a rule says so.*

- **Product Delivery Is Everything**——已上线（Vercel + Neon + Inngest），每次 push 都跑 CI，有真实评测；不是 notebook demo。
- **可审计的护栏**——状态机掌控转换、审批类工具必须有已存储的审批记录、副作用幂等、不可篡改的审计日志、RLS。
  与 Keyhook 自己强调的 "immutable audit logs" 和业主阈值相呼应。
- **自检 / 自我改进**——60+ 个评测场景，禁止操作必须为 0；PM 的纠正会自动变成新的评测场景。
- **Stay Local**——新西兰《隐私法》IPP 12：境外模型服务商需显式确认；Pacific/Auckland 时区、NZD 分、惠灵顿种子数据。
- **不绑定模型**——默认 Claude；OpenAI/DeepSeek/Kimi 通过同一接口接入，按评测结果选择（Kimi 基线：54/60，紧急程度与工种
  100%，禁止操作 0）。

使用 Keyhook 的词汇：**work order**、**supplier**、**owner approval threshold**、**variation**。
