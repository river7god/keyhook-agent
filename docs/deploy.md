English | [简体中文](deploy.zh-CN.md)

# Deploying Keyhook-agent (demo)

Target: **Vercel** (Next.js app) + **Neon** (Postgres) + **Inngest Cloud** (workflows), all on free
tiers, region Sydney (closest to NZ). Optional: **Sentry** (errors), **Langfuse** (traces).
Never paste keys into chats, issues or commits — only into the provider dashboards or your local `.env`.

## 1. Neon (database)
1. Sign up at https://neon.tech with GitHub.
2. *New project* → name `keyhook-agent`, Postgres 17, region **AWS Asia Pacific (Sydney)**.
3. *Connection details*: copy **two** strings —
   - **Pooled** (host contains `-pooler`) → the app's `DATABASE_URL` on Vercel.
   - **Direct** (no `-pooler`) → for migrations and seeding from your machine.

## 2. Migrate and seed (from your machine)
In a terminal (values stay in this shell session only):
```bash
export DATABASE_URL='<Neon DIRECT connection string>'
pnpm exec tsx src/db/migrate.ts
ALLOW_REMOTE_SEED=true SEED_PM_PASSWORD='<a strong password, 12+ chars>' pnpm exec tsx src/db/seed/index.ts
unset DATABASE_URL
```
Seeding wipes all tables first; every demo PM signs in with that password. The migration creates
the `keyhook_app` role used for row-level security (Neon's owner role is allowed to).

## 3. Vercel (app)
1. Sign up at https://vercel.com with GitHub.
2. *Add New → Project* → import `river7god/keyhook-agent` (framework is detected).
3. *Settings → Functions → Region*: **Sydney (syd1)**.
4. *Settings → Environment Variables* (Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** string |
| `ANTHROPIC_API_KEY` | your Claude API key |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | set by the Inngest integration (step 4) |
| `SIMULATOR_MAX_MESSAGES_PER_HOUR` | e.g. `30` |
| `DAILY_LLM_BUDGET_USD` | e.g. `3` |
| `SENTRY_DSN` | optional (step 5) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | optional (step 6) |

Do **not** set `INNGEST_DEV` in production. Then *Deploy*.

## 4. Inngest Cloud (workflows)
1. Sign up at https://www.inngest.com with GitHub.
2. Easiest: install the **Inngest integration** from the Vercel Marketplace and link the project —
   it adds `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` and syncs the app on each deploy.
   Manual alternative: copy both keys from the Inngest dashboard into Vercel, redeploy, then
   *Apps → Sync new app* with `https://<your-domain>/api/inngest`.
3. Check *Functions*: `job-advance`, `follow-up-sweeper` (cron, every 5 min), `follow-up-handle`,
   `system-ping`.

## 5. Sentry (optional)
1. Sign up at https://sentry.io → *Create project* → platform **Next.js**.
2. Copy the **DSN** (`https://…@….ingest.sentry.io/…`) into Vercel as `SENTRY_DSN`; redeploy.
Server errors and agent failures are reported; request bodies, cookies and user data are stripped.

## 6. Langfuse tracing (optional)
Create a project at https://cloud.langfuse.com, then in Vercel:
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces` and
`OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Basic <base64 of publicKey:secretKey>`.

## 7. GitHub (live evals, optional)
Repository *Settings → Secrets and variables → Actions* → `ANTHROPIC_API_KEY`. The *Eval*
workflow then runs nightly and on demand.

## 8. Check it works
- `https://<domain>/api/v1/health` → `{"status":"ok","db":"ok"}`
- Sign in as `aroha@harbourcity.example.test` with the seed password.
- Simulator: send "No hot water" as a tenant → the job should reach AWAITING_QUOTE within a
  minute; the run appears in Inngest.

**Troubleshooting:** `prepared statement … does not exist` → `DATABASE_URL` must be the pooled
host (prepared statements are disabled automatically for `-pooler` hosts, or set
`DATABASE_PREPARE=false`). 401 everywhere after sign-in → the site must be served over HTTPS
(session cookie is `Secure` in production).
