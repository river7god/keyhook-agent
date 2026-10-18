import type { LucideIcon } from 'lucide-react';
import {
  Camera,
  ClipboardCheck,
  Code,
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

export interface AgentInfo {
  id: string;
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
    id: 'inbox',
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
    id: 'engineering',
    name: 'Engineering agents',
    icon: Code,
    status: 'planned',
    trigger: 'Scheduled',
    autonomy: 'Acts with approval',
    summary: 'Regression evals, security and load tests, incident triage — for Keyhook itself.',
    does: ['Nightly eval runs', 'Incident triage from errors', 'PR review'],
    humanDecides: 'Merging and production changes',
  },
];

export const STATUS_LABEL: Record<AgentStatus, string> = {
  live: 'Live',
  next: 'Next',
  planned: 'Planned',
};
