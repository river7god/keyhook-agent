English | [简体中文](interview-architecture.zh-CN.md)

# Keyhook-agent Architecture at a Glance

> Details: [knowledge lookup](interview-lookup.md) · [full guide](interview-guide.md)

## Business architecture

```
Actors: Tenant ── reports / confirms ──┐
        Tradie ── quotes / completes ──┤
                                       ▼
                    Keyhook AI agent (runs the job end to end)
                                       │ only when a human is needed
                                       ▼
        Property manager ── approves / handles escalations ── Owner (sets spend limit)
```

| Line of business | Flow |
|---|---|
| Maintenance jobs (core) | Report → triage → tradie quote → (approval) → schedule → repair → tenant confirms → close |
| Rent arrears | Reminder → record promise to pay → formal notice (approval) → escalate |
| Portfolio monitor | Daily scan for repeated faults |
| Ops analyst | Weekly operations brief for managers |

**Human/agent boundary**: small spend is auto-approved; over-limit, emergencies, legal issues and
low confidence go to the manager.

## Technical architecture

```
Access      Next.js: manager dashboard + message simulator + API
Workflow    Inngest: event wake-ups, 3 retries, one run per job, timed follow-ups
            State machine: allowed next states (source of truth)
AI          advanceJob: handler per state, tool loop of at most 6 steps
            Claude / DeepSeek / Kimi with failover + circuit breaker
Tools       executeTool: validate → permission → idempotency → audit
Domain+DB   Postgres + Drizzle, RLS per organization, money in integer cents
Quality     Fake-LLM tests · 84 eval scenarios · red team · CI + AI code review · Langfuse/Sentry
```

**Core principle**: the AI understands and writes; code decides.
