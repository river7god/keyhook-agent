English | [简体中文](keyhook-fit.zh-CN.md)

# Keyhook-agent × Keyhook — product fit (2026-10-18)

How this project relates to Keyhook's existing platform, based on the public website
(keyhook.com, /features, /pricing, /about, read 2026-10-18). Marketing pages only — nothing here
claims knowledge of Keyhook's internals. This is an independent project.

## 1. Keyhook today (public site)

| | |
|---|---|
| Positioning | All-in-one property management platform for property managers — "the simplest and smartest way to run their entire business" |
| Company | Founded in Wellington (Luke and Aaron); offices in Auckland, Wellington, Christchurch; "100% Local Based Support" |
| Scale claims | 25,000+ active users; 4.9 app rating; "40%+" less admin |
| Pricing | Custom, by portfolio size; no public price list |
| Values | Innovate, Don't Imitate · Stay Local · Product Delivery Is Everything · Relationships Are Everything |

Modules: listings (Trade Me, RealEstate.co.nz, OneRoof, Homes.co.nz) · tenant screening (credit,
Police, Courts, Tenancy Tribunal) · documents & e-signing · **inspections** (offline app, photo/video,
voice notes, findings → maintenance jobs) · **maintenance** (tenant requests with photos/video,
supplier management, owner approval workflows with budget thresholds, invoices matched to work
orders) · financials (bank feeds, auto-matching, **automated arrears reminders**, trust accounting) ·
**compliance** (RTA & Healthy Homes templates, expiry alerts, **immutable audit logs**, bond
monitoring) · tenant / owner / supplier portals ("AI-powered automated updates").

## 2. Where the role points

The site's "AI Powered" features read as assistive automation: auto-replies, invoice extraction,
payment matching, scheduled reminders. The role asks for agents that "progress a maintenance issue
from start to finish". On the maintenance page the data and approvals exist; the middle is not
described:

| Maintenance step | On the site | Not described |
|---|---|---|
| Tenant request with photos/video | ✅ | |
| Owner approval with budget thresholds; quote/variation approval in owner portal | ✅ | |
| Invoice ↔ work order matching | ✅ | |
| Work order status (New → In Progress → Complete) | ✅ | |
| Judge urgency, pick a supplier | | ❓ |
| Chase quotes, reassign, agree a visit time | | ❓ |
| Keep the tenant informed, confirm the fix | | ❓ |
| Decide when a person is needed | | ❓ |

That missing middle is what Keyhook-agent does.

## 3. Mapping

| Keyhook capability | Keyhook-agent | Status |
|---|---|---|
| Owner approval + budget thresholds | Three-tier policy (PM limit → owner limit → escalate), enforced in code | Done |
| Immutable audit logs | Append-only `audit_log` (DB trigger), every agent/PM action | Done |
| Tenant / supplier portals | Messaging adapter (mock outbox; portal adapters later) | Port in place |
| Multi-agency SaaS | `organization_id` everywhere + Postgres RLS | Done |
| Tenant photos/video on requests | Media request + analysis | Done — photos (M6); video planned |
| Quote **variations** approved by owner | Variation flow | Done (M7) |
| Invoices matched to work orders | Invoice vs approved amount check | Done (M7) — text and photo |
| Inspection findings → maintenance jobs | `source: inspection` exists; intake API | **Planned (R4)** |
| Owner portal updates | Owner notifications at approval / completion | Done (M7) — via outbox |
| "AI-powered automated updates" to tenants | Milestone updates to tenants | Done (M7) |
| Healthy Homes / expiry alerts | Portfolio Monitor agent | **Planned (R7)** |
| Automated arrears reminders | Arrears workflow on the same platform | **Planned (R8)** |
| Listings, screening, e-signing, trust accounting, reporting | — | Out of scope: Keyhook platform, integrate via ports |

## 4. Pitch and talking points

**One line:** *The agent layer that moves a Keyhook work order from tenant request to closed —
dispatching, chasing, scheduling and confirming — and hands the property manager an escalation
package only when a rule says so.*

- **Product Delivery Is Everything** — deployed (Vercel + Neon + Inngest), CI on every push, live
  evals; not a notebook demo.
- **Guardrails you can audit** — state machine owns transitions, approval tools need a stored
  approval, idempotent side effects, immutable audit log, RLS. Echoes Keyhook's own "immutable
  audit logs" and owner thresholds.
- **Checks its own work / improves itself** — 60+ eval scenarios; forbidden actions must be 0;
  PM corrections become new eval scenarios automatically.
- **Stay Local** — NZ Privacy Act IPP 12: offshore model providers need explicit acknowledgement;
  Pacific/Auckland time, NZD cents, Wellington seed data.
- **Model-agnostic** — Claude by default; OpenAI/DeepSeek/Kimi behind one interface, chosen by
  eval results (Kimi baseline: 54/60, urgency & trade 100%, forbidden 0).

Use Keyhook's vocabulary: **work order**, **supplier**, **owner approval threshold**, **variation**.
