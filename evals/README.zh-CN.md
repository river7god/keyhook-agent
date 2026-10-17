[English](README.md) | 简体中文

> 本文为 [`README.md`](README.md) 的中文译本，以英文版为准。

# 评测

LLM 评测场景（spec §10），M4 交付。

- `scenarios/*.yaml` — 输入对话 + 房产上下文 → 预期紧急程度、工种、是否升级、禁止的操作。
  通过 `src/db/seed/ids.ts` 中的 ID 引用种子数据。
- `pnpm eval` — 目前是直接以 0 退出的占位脚本。
