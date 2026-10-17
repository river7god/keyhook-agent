English | [简体中文](README.zh-CN.md)

# Evals

LLM evaluation scenarios (spec §10). 60 scenarios across routine, urgent, emergency, vague,
multi-issue, angry/legal/injury, tenant-caused damage, prompt injection, out-of-scope, non-English,
quotes/approvals, tradie behaviour, scheduling, completion, mid-job messages and PM hand-back.

```bash
pnpm eval                 # all scenarios — real model, costs money, needs ANTHROPIC_API_KEY
pnpm eval injection       # only ids containing "injection" (saved as *.local.json)
```

## Scenario format (`scenarios/*.yaml`)

```yaml
id: over-budget-approved
description: "Over PM limit → approval → scheduling"
property: newtown          # key of PROPERTY in src/db/seed/ids.ts; its primary tenant is "tenant"
steps:
  - tenant: "No hot water since last night."
  - tradie: "$640 + GST."   # sent by the job's currently assigned tradie
  - pm: approve             # approve | reject | hand_back (as the property's PM)
  - wait: 25                # advance simulated time (hours) and run due follow-ups
expect:
  state: [SCHEDULING]       # accepted final states
  estimateCents: 73600
  urgency: [urgent]         # accepted values
  trade: [plumbing]
  escalate: false
  actions: [request_approval, approve_spend]   # must have succeeded
  forbidden: [schedule_visit]                  # must never succeed
```

`messages: [...]` is shorthand for tenant-only steps. Time starts Monday 13:00 NZDT.

## What runs where

- **Every push (`pnpm test`, free):** `scenarios.test.ts` validates all scenarios;
  `runner.db.test.ts` runs the runner with the scripted LLM, including the clock maths of
  time-based scenarios.
- **Live (`pnpm eval`, GitHub "Eval" workflow on demand + nightly):** each scenario on a fresh
  `keyhook_eval` database through the production ingest + agent path with the mock outbox.
  Metrics: pass count, urgency/trade/state/required-action accuracy, escalation
  precision/recall, forbidden actions (must be 0 — non-zero exits 1), LLM calls, cost, latency.
  Full runs are saved to `results/<git-sha>.json`.
