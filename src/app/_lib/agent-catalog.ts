import type { LucideIcon } from 'lucide-react';
import {
  Camera,
  FlaskConical,
  Gauge,
  GitPullRequest,
  ListChecks,
  Rocket,
  ShieldAlert,
  Siren,
  Terminal,
  TestTubeDiagonal,
  ClipboardCheck,
  Bug,
  FileText,
  HandCoins,
  Inbox,
  Megaphone,
  MessagesSquare,
  Radar,
  Receipt,
  Scale,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';

/**
 * Presentation catalog of agents (docs/agents.md, docs/roadmap.md). Status reflects this repo:
 * live = shipped and covered by tests + evals; next = the planned milestone; planned = roadmap.
 */
export type AgentStatus = 'live' | 'next' | 'planned';

/**
 * What the agent works on. Property operations act for the agency's customers; the others keep
 * the platform honest, fast and cheap, and ship it.
 */
export type AgentCategory = 'operations' | 'quality' | 'platform' | 'delivery';

export const CATEGORIES: { id: AgentCategory; label: string; blurb: string }[] = [
  {
    id: 'operations',
    label: 'Property operations',
    blurb: 'Work for tenants, suppliers, owners and property managers.',
  },
  {
    id: 'quality',
    label: 'Quality & safety',
    blurb: 'Agents that test the other agents before customers meet them.',
  },
  {
    id: 'platform',
    label: 'Platform operations',
    blurb: 'Watch cost, speed and reliability of the agents themselves.',
  },
  {
    id: 'delivery',
    label: 'Engineering & delivery (CI/CD)',
    blurb:
      'Write, review and ship the code. The agent that writes a change never approves it (docs/ai-delivery.md).',
  },
];

export interface AgentInfo {
  id: string;
  category: AgentCategory;
  name: string;
  icon: LucideIcon;
  status: AgentStatus;
  trigger: 'Reactive' | 'Proactive' | 'Human-invoked' | 'Scheduled';
  autonomy: 'Acts within limits' | 'Acts with approval' | 'Suggests only' | 'Prepares only';
  summary: string;
  does: string[];
  humanDecides: string;
  /** Where to see it working, for live agents. */
  href?: string;
}

export const AGENTS: AgentInfo[] = [
  {
    id: 'maintenance',
    category: 'operations',
    name: 'Maintenance',
    icon: Wrench,
    status: 'live',
    trigger: 'Reactive',
    autonomy: 'Acts within limits',
    summary:
      'Takes a request from the tenant’s first message to a closed work order: triage, supplier, quote, approval, visit, follow-ups and confirmation.',
    does: [
      'Triages urgency and trade, asks at most two questions',
      'Picks and briefs a supplier, chases silence, reassigns',
      'Offers visit times and books them with the tenant',
      'Confirms the fix and closes the job',
    ],
    humanDecides: 'Spend above the PM’s limit, emergencies, unclear responsibility',
    href: '/dashboard',
  },
  {
    id: 'vision',
    category: 'operations',
    name: 'Photo & document vision',
    icon: Camera,
    status: 'live',
    trigger: 'Reactive',
    autonomy: 'Acts within limits',
    summary:
      'Reads tenant photos and supplier documents: what is shown, safety cues, appliance labels, invoice totals.',
    does: [
      'Checks quality and asks for a retake with a concrete tip',
      'Reads make, model and serial from labels',
      'Flags instructions hidden in images',
    ],
    humanDecides: 'Anything the photo can’t settle',
    href: '/simulator',
  },
  {
    id: 'variations',
    category: 'operations',
    name: 'Variations & invoice check',
    icon: Receipt,
    status: 'live',
    trigger: 'Reactive',
    autonomy: 'Acts with approval',
    summary:
      'Re-checks extra costs against owner and PM limits and matches invoices to the approved amount.',
    does: [
      'Auto-approves small variations, holds the extra work otherwise',
      'Matches invoices within 5 % or NZ$50',
      'Explains differences to the PM',
    ],
    humanDecides: 'Variations above the limit, invoice differences',
    href: '/dashboard/approvals',
  },
  {
    id: 'inspections',
    category: 'operations',
    name: 'Inspection intake',
    icon: ClipboardCheck,
    status: 'live',
    trigger: 'Human-invoked',
    autonomy: 'Acts within limits',
    summary:
      'Turns an inspection finding into a work order and tells the tenant, rather than asking them.',
    does: [
      'Triages from the inspector’s notes',
      'Links the current tenant for access',
      'Sends vague notes back to the PM',
    ],
    humanDecides: 'Findings too vague to brief a supplier',
    href: '/dashboard/portfolio',
  },
  {
    id: 'monitor',
    category: 'operations',
    name: 'Portfolio Monitor',
    icon: Radar,
    status: 'live',
    trigger: 'Scheduled',
    autonomy: 'Suggests only',
    summary:
      'Scans the portfolio daily for repeated faults and proposes a permanent fix before the PM has to ask.',
    does: [
      '3+ same-trade jobs at a property in 12 months',
      'Evidence and a recommendation, once per pattern',
      'Re-raises only when new evidence appears',
    ],
    humanDecides: 'Whether it becomes a job',
    href: '/dashboard/portfolio',
  },
  {
    id: 'updates',
    category: 'operations',
    name: 'Tenant & owner updates',
    icon: MessagesSquare,
    status: 'live',
    trigger: 'Reactive',
    autonomy: 'Acts within limits',
    summary:
      'Keeps people informed at every milestone, in the language the tenant writes in, without exposing amounts to tenants.',
    does: [
      'Tenant: supplier engaged, awaiting approval, booked, done',
      'Owner: spend needs approval, job closed with final cost',
      'Follow-ups wait out quiet hours',
    ],
    humanDecides: 'Sensitive conversations',
  },
  {
    id: 'arrears',
    category: 'operations',
    name: 'Arrears',
    icon: HandCoins,
    status: 'live',
    trigger: 'Proactive',
    autonomy: 'Acts with approval',
    summary:
      'Spots missed rent daily, sends friendly reminders, agrees short promises and payment plans within policy, and follows up.',
    does: [
      'Promises within 7 days, plans that clear in 8 weeks',
      'Follows up broken promises; thanks on payment',
      'Drafts the 14-day notice from a fixed template',
    ],
    humanDecides: 'Formal notices, hardship, disputes, Tribunal',
    href: '/dashboard/arrears',
  },
  {
    id: 'redteam',
    category: 'quality',
    name: 'QA red team',
    icon: Bug,
    status: 'live',
    trigger: 'Human-invoked',
    autonomy: 'Suggests only',
    summary:
      'Writes new adversarial conversations, runs them through the real agents, and reports what broke — testing that finds bugs before customers do.',
    does: [
      'Injection variants, hidden emergencies, supplier fraud, arrears tricks',
      'Rules check the outcome; a judge reads what the agent said',
      'Failures become draft regression scenarios',
    ],
    humanDecides: 'Which failures become permanent tests',
  },
  {
    id: 'inbox',
    category: 'operations',
    name: 'Inbox router',
    icon: Inbox,
    status: 'planned',
    trigger: 'Reactive',
    autonomy: 'Acts within limits',
    summary: 'Classifies every inbound message and routes it to the right agent or person.',
    does: ['One front door for all agents', 'Language detection', 'Unknown intents to a PM'],
    humanDecides: 'Anything it can’t classify',
  },
  {
    id: 'letting',
    category: 'operations',
    name: 'Letting & listings',
    icon: Megaphone,
    status: 'planned',
    trigger: 'Proactive',
    autonomy: 'Acts with approval',
    summary:
      'Drafts listings from photos, adapts them per channel, answers enquiries and books viewings.',
    does: [
      'Copy for Trade Me, realestate.co.nz, OneRoof, social',
      'Facts-only enquiry answers, 24/7',
      'Anti-discrimination wording check',
    ],
    humanDecides: 'Publishing, rent, final copy',
  },
  {
    id: 'compliance',
    category: 'operations',
    name: 'Compliance & deadlines',
    icon: ShieldCheck,
    status: 'planned',
    trigger: 'Scheduled',
    autonomy: 'Suggests only',
    summary: 'Healthy Homes, smoke alarms, bond lodgement and notice periods, before they lapse.',
    does: ['Expiry and deadline watch', 'Opens jobs or reminders early', 'Evidence for audits'],
    humanDecides: 'Any legal notice',
  },
  {
    id: 'reports',
    category: 'operations',
    name: 'Inspection reports',
    icon: FileText,
    status: 'planned',
    trigger: 'Human-invoked',
    autonomy: 'Prepares only',
    summary:
      'Drafts the inspection report from photos and voice notes and compares with last time.',
    does: ['Room-by-room draft', 'Change since the last inspection', 'Raises follow-up jobs'],
    humanDecides: 'The final report, tenant fault',
  },
  {
    id: 'bond',
    category: 'operations',
    name: 'Exit & bond',
    icon: Scale,
    status: 'planned',
    trigger: 'Proactive',
    autonomy: 'Prepares only',
    summary: 'Compares outgoing and ingoing photos and drafts a bond claim with evidence.',
    does: ['Photo comparison', 'Damage quotes', 'Evidence pack'],
    humanDecides: 'Deductions and disputes',
  },
  {
    id: 'applications',
    category: 'operations',
    name: 'Applications assistant',
    icon: Users,
    status: 'planned',
    trigger: 'Reactive',
    autonomy: 'Prepares only',
    summary: 'Checks applications are complete and summarises them side by side.',
    does: ['Missing-document chasing', 'Side-by-side summary', 'Never ranks people'],
    humanDecides: 'Who gets the tenancy — always',
  },
  {
    id: 'suppliers',
    category: 'operations',
    name: 'Supplier insights',
    icon: Truck,
    status: 'planned',
    trigger: 'Scheduled',
    autonomy: 'Suggests only',
    summary: 'Ranks suppliers by real outcomes: response time, variations, invoice accuracy.',
    does: ['Outcome-based ranking', 'Feeds supplier selection', 'Flags re-work'],
    humanDecides: 'Removing a supplier',
  },
  {
    id: 'eval-runner',
    category: 'quality',
    name: 'Eval runner',
    icon: FlaskConical,
    status: 'live',
    trigger: 'Scheduled',
    autonomy: 'Suggests only',
    summary:
      'Plays 83 scripted conversations through the real agents every night and scores what they did.',
    does: [
      'Urgency, trade, escalation, final state, required actions',
      'Forbidden actions must stay at 0',
      'Results stored per commit; PM corrections become new scenarios',
    ],
    humanDecides: 'What a correct outcome is (the scenarios)',
    href: 'https://github.com/river7god/keyhook-agent/actions/workflows/eval.yml',
  },
  {
    id: 'ops-analyst',
    category: 'platform',
    name: 'Ops analyst',
    icon: Gauge,
    status: 'live',
    trigger: 'Scheduled',
    autonomy: 'Suggests only',
    summary:
      'Every Monday it reads model usage (cost, latency, cache, failures, rule hits) and writes a ranked brief of what to change.',
    does: [
      'Code detects the findings; the model only ranks and explains them',
      'Cheaper-model, cache, timeout and failure findings, with savings',
      'Proposes new layer-1 rules from repeated short replies',
    ],
    humanDecides: 'Any routing or rule change, after an eval',
    href: '/dashboard/usage',
  },
  {
    id: 'coder',
    category: 'delivery',
    name: 'Coder (Claude Code)',
    icon: Terminal,
    status: 'live',
    trigger: 'Human-invoked',
    autonomy: 'Acts with approval',
    summary:
      'Writes the code, tests, docs and decision records under the rules in CLAUDE.md. A task is done only when every check passes.',
    does: [
      'State machine, permissions, idempotency and audit rules',
      'Runs pnpm check and the evals before calling a task done',
      'Bilingual docs and a dated decision record per architecture change',
    ],
    humanDecides: 'What to build, and every merge',
    href: 'https://github.com/river7god/keyhook-agent/blob/main/CLAUDE.md',
  },
  {
    id: 'pr-reviewer',
    category: 'delivery',
    name: 'PR reviewer',
    icon: GitPullRequest,
    status: 'live',
    trigger: 'Reactive',
    autonomy: 'Suggests only',
    summary:
      'Reviews every pull request with a fresh context against CLAUDE.md. It never sees how the code was written.',
    does: [
      'Labels the risk tier A / B / C from the paths touched',
      'Findings need a concrete failure scenario; no style comments',
      'One advisory comment per PR, with its cost',
    ],
    humanDecides: 'Whether to merge',
    href: 'https://github.com/river7god/keyhook-agent/blob/main/.github/workflows/review.yml',
  },
  {
    id: 'security-reviewer',
    category: 'delivery',
    name: 'Security reviewer',
    icon: ShieldAlert,
    status: 'live',
    trigger: 'Reactive',
    autonomy: 'Suggests only',
    summary: 'A second, separate review whenever auth, data access, tools or API routes change.',
    does: [
      'Agency isolation and row-level security',
      'Approval-level tools, injection paths, secrets',
      'Reports injection attempts inside the diff itself',
    ],
    humanDecides: 'Whether to merge; tier C needs two people',
    href: 'https://github.com/river7god/keyhook-agent/blob/main/docs/ai-delivery.md',
  },
  {
    id: 'test-writer',
    category: 'delivery',
    name: 'Test writer',
    icon: TestTubeDiagonal,
    status: 'planned',
    trigger: 'Reactive',
    autonomy: 'Acts with approval',
    summary:
      'Writes tests from an issue’s acceptance criteria without seeing the implementation (stage 2).',
    does: ['Tests check the spec, not the code', 'Mutation testing weekly', 'Evals as a PR gate'],
    humanDecides: 'Acceptance criteria',
  },
  {
    id: 'planner',
    category: 'delivery',
    name: 'Planner',
    icon: ListChecks,
    status: 'planned',
    trigger: 'Human-invoked',
    autonomy: 'Prepares only',
    summary:
      'Turns a request into an issue with scope, acceptance criteria and a risk tier, for a coder agent to pick up (stage 3).',
    does: [
      'Scope and acceptance criteria',
      'Risk tier and affected files',
      'Draft PRs in a sandbox',
    ],
    humanDecides: 'Approving the plan — the most important gate',
  },
  {
    id: 'release',
    category: 'delivery',
    name: 'Release',
    icon: Rocket,
    status: 'planned',
    trigger: 'Reactive',
    autonomy: 'Acts with approval',
    summary:
      'Migrate → deploy → Inngest sync → health check → canary, with rollback on failure (stage 4).',
    does: [
      'Removes the manual migration step',
      'Release notes from merged PRs',
      'Tier A auto-merge',
    ],
    humanDecides: 'Migrations and tier C releases',
  },
  {
    id: 'ops-triage',
    category: 'delivery',
    name: 'Incident triage',
    icon: Siren,
    status: 'planned',
    trigger: 'Reactive',
    autonomy: 'Acts with approval',
    summary:
      'Turns a Sentry error or alert into a failing test that reproduces it, then a fix PR (stage 5).',
    does: ['Reproduce before fixing', 'Links trace, job and audit', 'Draft fix PR for on-call'],
    humanDecides: 'The fix, and incident command',
  },
];

export const STATUS_LABEL: Record<AgentStatus, string> = {
  live: 'Live',
  next: 'Next',
  planned: 'Planned',
};
