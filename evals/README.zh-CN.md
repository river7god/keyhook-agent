[English](README.md) | 简体中文

> 本文为 [`README.md`](README.md) 的中文译本，以英文版为准。

# 评测

LLM 评测场景（spec §10）。

```bash
pnpm eval                 # 运行全部场景（真实模型——会产生费用，需要 ANTHROPIC_API_KEY）
pnpm eval injection       # 只运行 id 包含 "injection" 的场景（结果保存为 *.local.json）
```

- `scenarios/*.yaml` — `property`（`src/db/seed/ids.ts` 中 `PROPERTY` 的键；由其当前主租客发消息）、
  `messages` 和 `expect`：`urgency` / `trade`（可接受的取值）、`escalate`、`forbidden`（绝不能成功执行的
  工具/审计动作）。
- 每个场景在全新的 `keyhook_eval` 数据库上运行，走生产环境的接入 + agent 路径，使用 mock 发件箱。
- 指标：紧急程度/工种准确率、升级准确率/精确率/召回率、禁止操作数（必须为 0——非 0 时退出码为 1）、
  成本和延迟。完整运行结果保存到 `results/<git-sha>.json`。
