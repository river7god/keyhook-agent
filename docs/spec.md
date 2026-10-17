English | [简体中文](spec.zh-CN.md)

# Keyhook-agent — Product Spec (v0.1)

## 1. Problem
A single maintenance request ("the hot water is cold") typically involves a tenant, a property
manager, an owner and a tradesperson, across messaging, a property system and a calendar, with
many manual steps: clarify, check the tenancy, decide responsibility, find a tradie, get a quote,
get owner approval, schedule, chase, confirm completion, close.

Keyhook-agent does this work end-to-end and only pulls in a person when judgement or authority is needed.

## 2. Users
- **Tenant** — reports issues, answers questions, confirms access and completion.
- **Property manager (PM)** — approves, overrides, handles escalations. Primary UI user.
- **Owner** — approves spend above the PM's limit (simulated via PM in v1).
- **Tradesperson** — receives job requests, quotes, schedules, reports completion.

## 3. The agent loop (maps directly to the role description)
| Capability | In Keyhook-agent |
|---|---|
| Understand | Classify issue type, urgency and likely trade from the tenant message (+ photo later) |
| Gather info | Look up property, tenancy, past jobs, tradies; ask tenant follow-up questions if needed |
| Decide | Urgency, responsibility, which tradie, whether approval is needed |
| Act | Message tradie/tenant, request quote, schedule visit, update job |
| Check own work | Validate each action's result against expectations before moving on |
| Escalate | Hand to PM with a summary + recommended action when rules say so |
| Keep going | Follow up on silence, re-assign tradies, confirm completion, close |

## 4. Scope
**v1 (MVP)**
- Tenant message intake (via simulator UI)
- Triage: issue type, urgency, trade, confidence
- Clarifying questions loop
- Tradie selection, quote request, approval check, scheduling
- Follow-ups and timeouts
- Completion confirmation with tenant, job close
- PM dashboard: job list, timeline, approvals queue, escalations, audit log
- Eval suite with ≥ 50 scenarios

**Later**
- Photo understanding
- Real SMS/email adapters
- Proactive monitoring (e.g. repeated issues at one property, Healthy Homes gaps)
- Second workflow (arrears) reusing the same tools/eval infrastructure

**Out of scope**
- Payments, invoicing, accounting integrations

## 5. Job state machine
```
RECEIVED → TRIAGED → NEEDS_INFO ⇄ (tenant replies) → TRIAGED
TRIAGED → AWAITING_QUOTE → AWAITING_APPROVAL → SCHEDULING → SCHEDULED
SCHEDULED → IN_PROGRESS → AWAITING_CONFIRMATION → CLOSED
Any state → ESCALATED (PM takes over or hands back)
Any state → CANCELLED (PM only)
```
- Approval is skipped when estimated cost ≤ PM auto-approval limit.
- Only transitions listed here are allowed; enforce in code, not in the prompt.

## 6. Urgency policy (product defaults — verify against NZ guidance before relying on them)
| Level | Examples | Target response |
|---|---|---|
| Emergency | Gas smell, exposed wiring/electrical hazard, major flooding, property can't be secured | Immediate escalation to PM + emergency tradie |
| Urgent | No hot water, no heating in cold weather, only toilet blocked, active leak | Tradie engaged within 24h |
| Routine | Dripping tap, sticking door, broken fixture | Within ~5 working days |

NZ context to model (confirm details from Tenancy Services before finalising):
landlord's obligation to keep premises in reasonable repair, tenant's obligation to notify
damage, Healthy Homes Standards (heating, insulation, ventilation, moisture/drainage, draught
stopping). This is product policy, not legal advice.

## 7. Escalation rules (any one triggers)
- Emergency urgency
- Estimated cost > owner approval limit for the property
- Triage confidence below threshold (start at 0.7, tune with evals)
- Tenant mentions injury, legal action, Tenancy Tribunal, or is clearly distressed/angry
- Tradie unresponsive after 2 follow-ups, and no alternative tradie available
- Suspected prompt injection or request outside agent's tools
- Responsibility unclear (possible tenant-caused damage)

Every escalation includes: summary, what's been done, recommended next action, links to evidence.

## 8. Tools
| Tool | Permission | Notes |
|---|---|---|
| get_property, get_tenancy, list_jobs_for_property | read | |
| search_tradies(trade, suburb) | read | ranked by availability, rating, distance |
| send_message(recipient, body) | auto | via adapter; idempotent; logged |
| request_quote(tradieId, jobId, scope) | auto | |
| schedule_visit(jobId, tradieId, window) | auto | must confirm tenant access first |
| update_job(jobId, transition, note) | auto | rejected if transition not allowed |
| request_approval(jobId, amountCents, reason) | auto | creates PM approval item |
| approve_spend(jobId) | approval | never callable by agent directly |
| escalate(jobId, reason, summary, recommendation) | auto | |
| add_note(jobId, text) | auto | |

## 9. Data model (initial)
properties, owners (approval_limit_cents), tenancies, tenants, tradies (trades, suburbs,
rating), jobs (state, urgency, trade, confidence, estimate_cents), messages, approvals,
audit_log, follow_ups.

Seed: ~10 properties across Wellington suburbs, ~15 tenancies, ~8 tradies across plumbing,
electrical, heating, general handyman, locksmith.

## 10. Evaluation
Scenario format (YAML in `evals/scenarios/`): input conversation + property context →
expected urgency, trade, escalate yes/no, forbidden actions.

Scenario mix: routine, urgent, emergency, vague messages, multi-issue messages, angry tenant,
tenant-caused damage, over-budget, unresponsive tradie, prompt injection, non-English message.

Metrics: urgency accuracy, trade accuracy, escalation precision/recall, forbidden-action
count (must be 0), cost per job, latency. Results tracked per commit.

## 11. Milestones
- **M0** Scaffold: Next.js, Drizzle, Postgres, Inngest, seed data, CI
- **M1** Happy path: message → triage → tradie → schedule → close (mock adapters)
- **M2** Clarifying questions, follow-ups, timeouts, approvals
- **M3** Escalation rules + PM dashboard (queue, timeline, audit log)
- **M4** Eval suite (≥ 50 scenarios) wired into CI; Langfuse tracing
- **M5** Deploy, hardening (injection tests, idempotency tests), record demo video
- **M6** Media intake and analysis (§12 R1)
- **M7** Variations, invoice check, owner notifications, tenant milestone updates (§12 R2, R3, R5, R6)
- **M8** Inspection-finding intake and Portfolio Monitor (§12 R4, R7)
- **M9** Arrears workflow on the same platform (§12 R8)

## 12. Alignment with the Keyhook platform (added 2026-10-18)
Derived from Keyhook's public site (see `docs/keyhook-fit.md`). Keyhook already provides listings,
screening, e-signing, trust accounting and reporting — **out of scope here**; the agent integrates
with them through adapters. Requirements below extend the maintenance agent to the parts of the
platform it touches. Rules marked *(proposed)* need product-owner confirmation before build.

**R1 — Tenant photos / video.** Keyhook tenants already attach media to requests.
- Ask for media only when it would change a decision: unclear trade, possible tenant responsibility,
  leak severity (water near electrics), or a part/model the supplier needs. Say exactly what to
  capture. The tenant may decline; the job continues.
- Quality check in code first (resolution, blur, darkness) and ask for a retake with concrete
  guidance; then the model judges relevance ("does it show the issue?").
- Extract: visible issue, safety cues, make/model/serial text. Pass relevant facts to the supplier.
- Media is untrusted input (text inside images can be a prompt injection).
- Video: analyse sampled key frames. *(proposed)* up to 60 s; media retained 180 days.

**R2 — Quote variations.** After approval a supplier may report extra work/cost.
- The new total is re-checked with the approval policy (§5): within the effective PM limit →
  continue; within owner limit → owner/PM approval; above → escalate. Work on the extra pauses
  until approved. Every variation is audited with the original and new amount.

**R3 — Invoice check (no payments).** Keyhook matches invoices to work orders.
- Extract the invoice total (PDF/photo) and compare with the approved amount (quote + approved
  variations). *(proposed)* Within 5 % or NZ$50 → mark matched; above → PM review with the
  difference explained. Payment execution stays out of scope.

**R4 — Inspection findings → work orders.** An inspection finding creates a job
(`source: inspection`) through the API with its notes/photos; the agent triages it as usual
(no tenant reply when there is no tenant on the job).

**R5 — Owner notifications.** The owner is told when spend needs their approval and when a job is
completed (with final cost). v1 still lets the PM approve on the owner's behalf (§2).

**R6 — Tenant milestone updates.** The tenant hears at each milestone without asking: supplier
engaged, visit booked, running late, awaiting approval (no amounts), completed.

**R7 — Portfolio Monitor (proactive).** Scheduled scan per organization. *(proposed)* Triggers: three
or more jobs of the same trade at one property within 12 months; compliance items near expiry
(Healthy Homes statements, smoke-alarm checks, building WOF) once a compliance data source exists.
It proposes an `agent_detected` job with the evidence; a PM opens it — the monitor never dispatches
on its own.

**R8 — Arrears.** Second workflow reusing tools, audit, approvals and evals (spec §4 "Later");
reminder cadence and the human boundary as in `docs/agents.md` §5.2.
