[English](README.md) | 简体中文

> 本文为 [`README.md`](README.md) 的中文译本，以英文版为准。

# Keyhook-agent

一个 AI agent：把新西兰住宅的维修请求从租客的第一条消息一直推进到工单关闭——分诊、找师傅、取得审批、
排期、跟进并确认完工——只有在真正需要人的时候才升级给物业经理。

> 作为 Keyhook **AI Product Engineer** 岗位的作品集项目而构建。
> 这是一个独立项目，与 Keyhook 无隶属关系，也未获其背书。
> 所有房产、租客和师傅数据均为虚构。

## 为什么
一个维修请求可能牵涉四个人、三个系统和许多手工步骤。本项目探索：在生产环境中，agent 能可靠地完成
其中多少工作——并配有护栏、审计记录、人工升级，以及用来证明这一切的评测集。

## Agent 做什么
1. **理解**请求——问题类型、紧急程度、可能的工种
2. **收集信息**——房产、租约、历史工单；向租客追问
3. **决策**——责任归属、选哪个师傅、花费是否需要审批
4. **行动**——给师傅和租客发消息、请求报价、安排上门
5. **自检**——每个动作都先验证再继续
6. **升级**——带着摘要和建议移交给物业经理
7. **持续推进**——无回应时跟进、重新分配、确认完工、关单

## 状态
🚧 进行中——里程碑见 [`docs/spec.zh-CN.md`](docs/spec.zh-CN.md)。

## 开发
环境要求：Node 24（`nvm use`）、pnpm 10、Docker（Docker Desktop、OrbStack 或 colima）。

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 17，localhost:54329（另含 keyhook_test 数据库）
pnpm db:migrate
pnpm db:seed        # 虚构的惠灵顿数据
pnpm dev            # Next.js 于 :3000 + Inngest 开发服务器于 :8288
```

在 http://localhost:3000 用 `aroha@harbourcity.example.test` / `keyhook-demo` 登录
（任一种子数据中的 PM；密码来自 `SEED_PM_PASSWORD`，仅限开发环境）。

| 脚本 | |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | 改动完成前必须通过 |
| `pnpm db:generate` | 修改 `src/db/schema/` 后生成迁移文件 |
| `pnpm db:reset` | 删除、迁移并重新灌入本地数据库 |
| `pnpm db:studio` | 浏览数据库 |
| `pnpm eval` | LLM 评测场景（M4 之前为占位） |

## 文档
- [`docs/spec.zh-CN.md`](docs/spec.zh-CN.md) — 产品规格
- [`docs/agents.zh-CN.md`](docs/agents.zh-CN.md) — Agent 目录与人机边界
- [`docs/keyhook-fit.zh-CN.md`](docs/keyhook-fit.zh-CN.md) — 与 Keyhook 平台的对应关系
- [`docs/decisions.zh-CN.md`](docs/decisions.zh-CN.md) — 架构决策
- [`docs/deploy.zh-CN.md`](docs/deploy.zh-CN.md) — 部署到 Vercel + Neon + Inngest Cloud
- [`CLAUDE.zh-CN.md`](CLAUDE.zh-CN.md) — 工程规则（参考译本；Claude Code 加载的是英文 `CLAUDE.md`）

每份文档都有对应的英文版（`*.md`），以英文版为准。
