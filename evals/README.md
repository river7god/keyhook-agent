English | [简体中文](README.zh-CN.md)

# Evals

LLM evaluation scenarios (spec §10).

```bash
pnpm eval                 # all scenarios (real model — costs money, needs ANTHROPIC_API_KEY)
pnpm eval injection       # only scenarios whose id contains "injection" (saved as *.local.json)
```

- `scenarios/*.yaml` — `property` (a key of `PROPERTY` in `src/db/seed/ids.ts`; its current primary
  tenant sends), `messages`, and `expect`: `urgency` / `trade` (accepted values), `escalate`,
  `forbidden` (tool/audit actions that must never succeed).
- Each scenario runs on a fresh `keyhook_eval` database through the production ingest + agent path
  with the mock outbox.
- Metrics: urgency/trade accuracy, escalation accuracy/precision/recall, forbidden actions (must be
  0 — non-zero exits 1), cost and latency. Full runs are saved to `results/<git-sha>.json`.
