English | [简体中文](development.zh-CN.md)

# Development guide

How to run Keyhook-agent locally, run the tests and evals, and choose a model. For deployment
see [`deploy.md`](deploy.md); for the engineering rules see [`../CLAUDE.md`](../CLAUDE.md).

## Requirements

- Node 24 (`nvm use`), pnpm 10
- Docker (Docker Desktop, OrbStack or colima) for Postgres 17
- A model API key: Anthropic (default), or OpenAI / DeepSeek / Kimi (see below)

## First run

```bash
pnpm install
cp .env.example .env        # then add a model key
pnpm db:up                  # Postgres 17 on localhost:54329 (+ keyhook_test database)
pnpm db:migrate
pnpm db:seed                # fictional Wellington agencies, properties, tenants, suppliers
pnpm dev                    # Next.js on :3000 + Inngest dev server on :8288
```

- App: http://localhost:3000. Sign in as `aroha@harbourcity.example.test` / `keyhook-demo`
  (any seeded PM; the password comes from `SEED_PM_PASSWORD`, dev only).
- Inngest dashboard: http://localhost:8288 (runs, events, retries, cron).
- The **Message simulator** acts as tenants and suppliers. Messages take the same path real
  SMS or email would. Outbound messages go to the mock outbox; nothing is really sent.

## Choosing a model

| Setting | Effect |
|---|---|
| nothing set | Claude (`claude-opus-5-5`) for every step; needs `ANTHROPIC_API_KEY` |
| `LLM_DEFAULT_MODEL=provider:model` | Deployment-wide default, e.g. `moonshot:kimi-k2.6`, `openai:<model>` |
| `LLM_VISION_MODEL=provider:model` | Model for photo analysis only (e.g. Claude while text runs on Kimi) |
| `LLM_ACKNOWLEDGE_OFFSHORE=true` | Required for DeepSeek / Kimi (NZ Privacy Act IPP 12 opt-in) |
| `organizations.llm_routing` | Per agency, per step group (`triage`, `act`, `interpret`, `compose`, `vision`) |

`ANTHROPIC_API_KEY` must be an API key from console.anthropic.com (`sk-ant-api…`, billed per
use). A Claude subscription login does not work as an API key.

## Everyday commands

| Command | |
|---|---|
| `pnpm check` | format + typecheck + lint + all tests. Must pass before a change is done |
| `pnpm test` | Vitest: unit tests and Postgres-backed tests (`*.db.test.ts`, on `keyhook_test`) |
| `pnpm db:generate` | Create a migration after editing `src/db/schema/` (add an RLS policy for new tables) |
| `pnpm db:reset` | Drop, migrate and re-seed the local database |
| `pnpm db:studio` | Browse the database |
| `pnpm eval` | Live LLM eval scenarios against the configured model |
| `pnpm eval --model moonshot:kimi-k2.6 id1,id2` | Compare a model, or run selected scenarios |
| `pnpm eval:smoke` | 15 representative scenarios, capped at US$2 (about $0.12 per scenario on Claude Opus 5.5) |
| `pnpm eval --max-cost 5` | Any run with a hard spend cap: stops before a scenario that would cross it |
| `pnpm redteam --n 8 --max-cost 1` | QA red team: generate adversarial cases, run them, write failures to `evals/scenarios/redteam/` (unreviewed) |
| `pnpm demo:data` | Add realistic activity to a demo database by running real conversations through the agents (adds only; `--yes` for a non-local database) |
| `pnpm eval:harvest` | Turn PM corrections into draft eval scenarios (review before committing) |

Eval results are written per commit and model to `evals/results/`. "Forbidden actions" must be 0.

## Working on the agent

- Read [`spec.md`](spec.md) and [`agents.md`](agents.md) first; the state machine in
  `src/workflows/state-machine.ts` is the source of truth.
- New tool → `src/tools/`, with a Zod schema, a permission level and an idempotency key.
- New behaviour → a DB test with the scripted model (`src/test/fake-llm.ts`) and an eval
  scenario in `evals/scenarios/`.
- Architecture decision → `docs/decisions.md` and its Chinese version.
