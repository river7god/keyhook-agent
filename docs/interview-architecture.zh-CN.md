[English](interview-architecture.md) | 简体中文

# Keyhook-agent 架构一览

> 详细内容：[知识点速查](interview-lookup.zh-CN.md) · [详细版](interview-guide.zh-CN.md)

## 业务架构

```
角色：租客 ── 报修/确认 ──┐
      Tradie ── 报价/完工 ─┤
                           ▼
              Keyhook AI Agent（闭环处理）
                           │ 只在需要人时
                           ▼
      物业经理 ── 审批/处理升级 ── 业主（设花费上限）
```

| 业务线 | 流程 |
|---|---|
| 维修工单（主线） | 报修 → 分诊 → 找 tradie 报价 → (审批) → 预约 → 维修 → 租客确认 → 关闭 |
| 欠租催收 | 提醒 → 记录还款承诺 → 正式通知（需审批）→ 升级 |
| 巡检 | 每天找出反复出现的故障 |
| 运营分析 | 每周给经理一份运营简报 |

**人机边界**：小额自动批准；超过上限、紧急情况、法律问题、低置信度都交给经理。

## 技术架构

```
接入层     Next.js：经理后台 + 消息模拟器 + API
流程层     Inngest：事件唤醒、重试 3 次、每个工单同时只跑一个、定时跟进
           状态机：决定下一步能去哪（真相来源）
AI 层      advanceJob：按状态选处理器，最多 6 步工具循环
           Claude / DeepSeek / Kimi，失败自动切换 + 熔断
工具层     executeTool：校验 → 权限 → 幂等 → 审计
领域+数据  Postgres + Drizzle，RLS 按公司隔离，金额用整数分
质量保障   假模型测试 · 84 个评测场景 · 红队 · CI + AI 代码审查 · Langfuse/Sentry
```

**核心原则**：AI 负责理解和写，代码负责决定。
