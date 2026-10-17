English | [简体中文](README.zh-CN.md)

# Evals

LLM evaluation scenarios (spec §10). Arrives in M4.

- `scenarios/*.yaml` — input conversation + property context → expected urgency, trade,
  escalate yes/no, forbidden actions. Reference seed fixtures by the ids in `src/db/seed/ids.ts`.
- `pnpm eval` — currently a stub that exits 0.
