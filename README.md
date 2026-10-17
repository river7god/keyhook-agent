English | [简体中文](README.zh-CN.md)

# Keyhook-agent

An AI agent that takes a New Zealand residential maintenance request from the tenant's first
message to a closed job — triaging, finding a tradie, getting approval, scheduling, following
up and confirming completion — and escalates to a property manager only when a human is
genuinely needed.

> Built as a portfolio project for the **AI Product Engineer** role at Keyhook.
> This is an independent project and is not affiliated with or endorsed by Keyhook.
> All property, tenant and tradie data is fictional.

## Why
A single maintenance request can involve four people, three systems and many manual steps.
This project explores how much of that work an agent can do reliably in production — with
guardrails, audit trails, human escalation and an evaluation suite to prove it.

## What the agent does
1. **Understands** the request — issue type, urgency, likely trade
2. **Gathers information** — property, tenancy, job history; asks the tenant follow-up questions
3. **Decides** — responsibility, tradie, whether spend needs approval
4. **Acts** — messages tradies and tenants, requests quotes, schedules visits
5. **Checks its own work** — validates every action before moving on
6. **Escalates** — hands off to a property manager with a summary and recommendation
7. **Keeps going** — follows up on silence, reassigns, confirms completion, closes the job

## Status
🚧 In progress — see milestones in [`docs/spec.md`](docs/spec.md).

## Development
Requirements: Node 24 (`nvm use`), pnpm 10, Docker (Docker Desktop, OrbStack or colima).

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 17 on localhost:54329 (+ keyhook_test database)
pnpm db:migrate
pnpm db:seed        # fictional Wellington data
pnpm dev            # Next.js on :3000 + Inngest dev server on :8288
```

| Script | |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | must pass before a change is done |
| `pnpm db:generate` | create a migration after editing `src/db/schema/` |
| `pnpm db:reset` | drop, migrate and re-seed the local database |
| `pnpm db:studio` | browse the database |
| `pnpm eval` | LLM eval scenarios (stub until M4) |

## Docs
- [`docs/spec.md`](docs/spec.md) — product spec
- [`docs/agents.md`](docs/agents.md) — agent catalog and human/agent boundaries
- [`docs/decisions.md`](docs/decisions.md) — architecture decisions
- [`CLAUDE.md`](CLAUDE.md) — engineering rules (also used by Claude Code)

Every document has a Simplified Chinese version alongside it (`*.zh-CN.md`); English is canonical.
