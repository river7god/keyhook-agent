[English](development.md) | 简体中文

> 本文为 [`development.md`](development.md) 的中文译本，以英文版为准。

# 开发指南

讲怎么在本地运行 Keyhook-agent、跑测试和 eval、选择模型。部署见 [`deploy.zh-CN.md`](deploy.zh-CN.md)；
工程规则见 [`../CLAUDE.zh-CN.md`](../CLAUDE.zh-CN.md)。

## 环境要求

- Node 24（`nvm use`）、pnpm 10
- Docker（Docker Desktop、OrbStack 或 colima），用于运行 Postgres 17
- 一个模型 API key：Anthropic（默认），或 OpenAI / DeepSeek / Kimi（见下文）

## 第一次运行

```bash
pnpm install
cp .env.example .env        # 然后填入模型 key
pnpm db:up                  # Postgres 17，端口 localhost:54329（另含 keyhook_test 数据库）
pnpm db:migrate
pnpm db:seed                # 虚构的惠灵顿物业公司、房产、租客、供应商
pnpm dev                    # Next.js 在 :3000，Inngest 开发服务器在 :8288
```

- 应用：http://localhost:3000。用 `aroha@harbourcity.example.test` / `keyhook-demo` 登录
  （任何一个种子 PM 都可以；密码来自 `SEED_PM_PASSWORD`，仅限开发环境）。
- Inngest 控制台：http://localhost:8288（运行记录、事件、重试、定时任务）。
- **消息模拟器**可以扮演租客和供应商。消息走的路径和真实短信/邮件一样。外发消息进入模拟发件箱，不会真的发出去。

## 选择模型

| 设置 | 效果 |
|---|---|
| 什么都不设 | 每一步都用 Claude（`claude-opus-5-5`）；需要 `ANTHROPIC_API_KEY` |
| `LLM_DEFAULT_MODEL=provider:model` | 整个部署的默认模型，例如 `moonshot:kimi-k2.6`、`openai:<model>` |
| `LLM_VISION_MODEL=provider:model` | 只用于看图的模型（例如文字用 Kimi，看图用 Claude） |
| `LLM_ACKNOWLEDGE_OFFSHORE=true` | 使用 DeepSeek / Kimi 时必须设置（新西兰 Privacy Act IPP 12 的明确同意） |
| `organizations.llm_routing` | 按物业公司、按步骤组（`triage`、`act`、`interpret`、`compose`、`vision`）配置 |

`ANTHROPIC_API_KEY` 必须是在 console.anthropic.com 创建的 API key（以 `sk-ant-api…` 开头，按量计费）。
Claude 订阅的登录凭证不能当 API key 用。

## 常用命令

| 命令 | |
|---|---|
| `pnpm check` | 格式 + 类型检查 + lint + 全部测试。改动完成前必须通过 |
| `pnpm test` | Vitest：单元测试和连 Postgres 的测试（`*.db.test.ts`，使用 `keyhook_test`） |
| `pnpm db:generate` | 修改 `src/db/schema/` 后生成迁移（新表要加 RLS 策略） |
| `pnpm db:reset` | 删库、迁移、重新灌种子数据 |
| `pnpm db:studio` | 浏览数据库 |
| `pnpm eval` | 用当前配置的模型跑实测 LLM eval 场景 |
| `pnpm eval --model moonshot:kimi-k2.6 id1,id2` | 对比某个模型，或只跑指定场景 |
| `pnpm eval:smoke` | 15 个有代表性的场景，花费上限 US$2（Claude Opus 5.5 上约每个场景 $0.12） |
| `pnpm eval --max-cost 5` | 任何一次运行都可以设硬性花费上限：会在可能超支的场景开始前停下 |
| `pnpm eval:harvest` | 把 PM 的纠正转成待审核的 eval 场景（提交前要人工审核） |

Eval 结果按提交和模型写入 `evals/results/`。"禁止动作"必须为 0。

## 开发 agent 时

- 先读 [`spec.zh-CN.md`](spec.zh-CN.md) 和 [`agents.zh-CN.md`](agents.zh-CN.md)；`src/workflows/state-machine.ts` 里的状态机是唯一依据。
- 新工具 → 放在 `src/tools/`，带 Zod schema、权限级别和幂等键。
- 新行为 → 用脚本化模型（`src/test/fake-llm.ts`）写一个数据库测试，并在 `evals/scenarios/` 加 eval 场景。
- 架构决策 → 写进 `docs/decisions.md` 和对应的中文版。
