import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { approvals, messages } from '@/db/schema';
import {
  getCase,
  ledgerPosition,
  loadCaseContext,
  patchCase,
  paymentsSince,
  transitionCase,
  type ArrearsCase,
  type CaseContext,
  type LedgerPosition,
} from '@/domain/arrears';
import { loadWorkflowPolicy } from '@/domain/follow-ups';
import { deliverQueuedForCase, type Message } from '@/domain/messages';
import { formatNzd, parseNzdToCents } from '@/lib/money';
import { addDays, daysBetween, formatCalendarDate, nzDate } from '@/lib/time';
import {
  escalateArrearsTool,
  recordPromiseTool,
  requestNoticeApprovalTool,
  sendArrearsMessageTool,
} from '@/tools/arrears-tools';
import { executeTool } from '@/tools/execute';
import type { ToolContext } from '@/tools/types';
import { ARREARS_TERMINAL } from '@/workflows/arrears-states';
import type { WorkflowPolicy } from '@/domain/workflow-policy-config';
import { alreadyProcessed, markProcessed, must, type AgentDeps } from '../handlers/shared';
import { composeOutput } from '../schemas';
import { untrusted } from '../untrusted';
import { COMPOSE_ARREARS_SYSTEM, INTERPRET_ARREARS_SYSTEM } from './prompts';
import { arrearsReplyOutput, type ArrearsReplyOutput } from './schemas';

/**
 * Arrears agent (spec §12 R8): "extract → code decides → compose", like maintenance.
 * Time rules run on the daily sweep; replies run when the tenant writes. Every effect goes through
 * executeTool (permissions, idempotency, audit) in one transaction per step.
 */
type Policy = WorkflowPolicy['arrears'];
export type ArrearsStep =
  | 'resolved'
  | 'reminded'
  | 'promise_kept'
  | 'promise_broken'
  | 'notice_requested'
  | 'escalated'
  | 'recorded_promise'
  | 'answered'
  | 'waiting'
  | 'ignored';

export async function advanceArrears(
  deps: AgentDeps,
  args: { organizationId: string; caseId: string; messageId?: string | null },
): Promise<{ step: ArrearsStep }> {
  const c = await getCase(deps.db, args.organizationId, args.caseId);
  const msg = args.messageId ? await loadInbound(deps.db, c, args.messageId) : null;
  if (msg && (await alreadyProcessed(deps.db, msg))) return { step: 'ignored' };
  if (ARREARS_TERMINAL.includes(c.state)) {
    if (msg) await deps.db.transaction((tx) => markProcessed(tx, msg));
    return { step: 'ignored' };
  }
  const now = deps.now();
  const today = nzDate(now);
  const policy = (await loadWorkflowPolicy(deps.db, c.organizationId)).arrears;
  const pos = await ledgerPosition(deps.db, c.organizationId, c.tenancyId, today);
  const facts = await loadCaseContext(deps.db, c);
  const run = { deps, c, facts, pos, policy, today, now };

  const step =
    pos.balanceCents === 0
      ? await resolve(run, msg)
      : msg
        ? await handleReply(run, msg)
        : await handleTime(run);
  await deliverQueuedForCase(deps.db, c.organizationId, c.id);
  return { step };
}

interface Run {
  deps: AgentDeps;
  c: ArrearsCase;
  facts: CaseContext;
  pos: LedgerPosition;
  policy: Policy;
  today: string;
  now: Date;
}

function tc(run: Run, db: DbOrTx, reason: string, suffix = ''): ToolContext {
  return {
    db,
    organizationId: run.c.organizationId,
    jobId: null,
    arrearsCaseId: run.c.id,
    reason,
    idempotencyScope: `arrears:${run.c.id}:v${String(run.c.version)}${suffix}`,
    now: run.now,
  };
}

/** Patch the evaluated balance in the same transaction when it moved. */
async function refreshBalance(run: Run, db: DbOrTx) {
  if (
    run.pos.balanceCents === run.c.balanceCents &&
    run.pos.oldestUnpaidDate === run.c.oldestUnpaidDate
  )
    return;
  if (!run.pos.oldestUnpaidDate) return;
  await patchCase(db, {
    organizationId: run.c.organizationId,
    caseId: run.c.id,
    patch: { balanceCents: run.pos.balanceCents, oldestUnpaidDate: run.pos.oldestUnpaidDate },
    reason: `Balance now ${formatNzd(run.pos.balanceCents)}`,
  });
}

function factLines(run: Run): string[] {
  const { facts, pos, c } = run;
  return [
    `Today: ${run.today}`,
    `Tenant: ${facts.tenantName} (profile language: ${facts.preferredLanguage})`,
    `Property: ${facts.address}, ${facts.suburb}`,
    facts.rentCents
      ? `Rent: ${formatNzd(facts.rentCents)} ${facts.rentFrequency ?? ''}`.trim()
      : 'Rent: unknown',
    `Amount overdue: ${formatNzd(pos.balanceCents)}`,
    pos.oldestUnpaidDate
      ? `Oldest unpaid rent was due: ${formatCalendarDate(pos.oldestUnpaidDate)} (${String(pos.daysOverdue)} days ago)`
      : 'Nothing overdue',
    `Case state: ${c.state}`,
    c.promiseDate && c.promiseAmountCents
      ? `Current commitment: ${formatNzd(c.promiseAmountCents)} by ${formatCalendarDate(c.promiseDate)}${c.planFrequency ? ` (${c.planFrequency} plan)` : ''}`
      : 'No current commitment',
    c.noticeSentAt
      ? `Formal notice sent; remedy by ${c.remedyByDate ?? ''}`
      : 'No formal notice sent',
  ];
}

async function conversation(db: DbOrTx, c: ArrearsCase): Promise<string> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, c.organizationId), eq(messages.arrearsCaseId, c.id)))
    .orderBy(asc(messages.createdAt));
  return (
    rows
      .slice(-10)
      .map((m) =>
        m.direction === 'inbound'
          ? `tenant:\n${untrusted(m.body, { from: 'tenant' })}`
          : `agent → ${m.recipientType}: ${m.body}`,
      )
      .join('\n\n') || '(none)'
  );
}

async function compose(run: Run, purpose: string, extra: string[] = []): Promise<string> {
  const out = await run.deps.llm.structured({
    ctx: { organizationId: run.c.organizationId, jobId: null, step: 'compose.arrears' },
    system: COMPOSE_ARREARS_SYSTEM,
    user: [
      `Purpose: ${purpose}`,
      '',
      'Facts:',
      ...factLines(run),
      ...extra,
      '',
      'Conversation so far:',
      await conversation(run.deps.db, run.c),
    ].join('\n'),
    schema: composeOutput,
    effort: 'low',
  });
  return out.body.trim();
}

async function send(run: Run, db: DbOrTx, body: string, reason: string, suffix = '') {
  must(
    await executeTool(sendArrearsMessageTool, tc(run, db, reason, suffix), {
      recipient: 'tenant',
      body,
    }),
  );
}

async function escalate(
  run: Run,
  db: DbOrTx,
  args: { reason: string; summary: string; recommendation: string },
  suffix = '',
) {
  must(await executeTool(escalateArrearsTool, tc(run, db, args.reason, suffix), args));
}

// ---------- Paid up ----------

async function resolve(run: Run, msg: Message | null): Promise<ArrearsStep> {
  const thanks = await compose(
    run,
    'The rent arrears are now fully paid. Thank the tenant briefly; no further action is needed.',
  );
  await run.deps.db.transaction(async (tx) => {
    if (msg) await markProcessed(tx, msg);
    await send(run, tx, thanks, 'Arrears cleared', ':resolved');
    // A notice still waiting for the PM is moot once the rent is paid.
    await tx
      .update(approvals)
      .set({ status: 'expired' })
      .where(
        and(
          eq(approvals.organizationId, run.c.organizationId),
          eq(approvals.arrearsCaseId, run.c.id),
          eq(approvals.status, 'pending'),
        ),
      );
    await transitionCase(tx, {
      organizationId: run.c.organizationId,
      caseId: run.c.id,
      to: 'RESOLVED',
      actor: { type: 'agent' },
      reason: 'Balance cleared',
      patch: { balanceCents: 0 },
      now: run.now,
    });
  });
  return 'resolved';
}

// ---------- Time rules (daily sweep) ----------

async function handleTime(run: Run): Promise<ArrearsStep> {
  const { c, pos, policy } = run;
  const db = run.deps.db;

  if (c.state === 'ESCALATED' || c.state === 'NOTICE_PENDING') {
    await db.transaction((tx) => refreshBalance(run, tx));
    return 'waiting';
  }

  if (pos.daysOverdue >= policy.tribunalAtDays) {
    await db.transaction(async (tx) => {
      await refreshBalance(run, tx);
      await escalate(run, tx, {
        reason: `Rent ${String(pos.daysOverdue)} days in arrears (${formatNzd(pos.balanceCents)})`,
        summary: `Arrears have reached ${String(pos.daysOverdue)} days. ${c.noticeSentAt ? `A 14-day notice was sent; remedy date ${c.remedyByDate ?? ''}.` : 'No formal notice has been sent.'}`,
        recommendation:
          'Call the tenant. Applying to the Tenancy Tribunal is a person’s decision — the agent will not take further steps.',
      });
    });
    return 'escalated';
  }

  const sinceReminder = c.lastReminderAt
    ? daysBetween(nzDate(c.lastReminderAt), run.today)
    : Infinity;

  if (c.state === 'OPEN') {
    const body = await compose(
      run,
      'First friendly reminder that rent is overdue: state the amount and due date, ask when they can pay, and invite them to tell us if they are having difficulty.',
    );
    await db.transaction(async (tx) => {
      await refreshBalance(run, tx);
      await send(run, tx, body, 'First arrears reminder');
      await transitionCase(tx, {
        organizationId: c.organizationId,
        caseId: c.id,
        to: 'REMINDED',
        actor: { type: 'agent' },
        reason: `First reminder (${formatNzd(pos.balanceCents)}, ${String(pos.daysOverdue)} days)`,
        patch: { remindersSent: 1, lastReminderAt: run.now },
        now: run.now,
      });
    });
    return 'reminded';
  }

  if (c.state === 'PROMISED' && c.promiseDate && c.promiseAmountCents) {
    if (run.today <= c.promiseDate) return 'waiting';
    const paid = await paymentsSince(
      db,
      c.organizationId,
      c.tenancyId,
      c.promiseMadeOn ?? c.promiseDate,
    );
    if (paid >= c.promiseAmountCents) {
      // Kept. A plan rolls on to its next instalment; a one-off promise that left a balance goes
      // back to reminders.
      if (c.planInstalmentCents && c.planFrequency) {
        const next = addDays(c.promiseDate, c.planFrequency === 'weekly' ? 7 : 14);
        await db.transaction(async (tx) => {
          await refreshBalance(run, tx);
          await patchCase(tx, {
            organizationId: c.organizationId,
            caseId: c.id,
            patch: { promiseDate: next, promiseMadeOn: run.today },
            reason: `Plan instalment received; next ${formatNzd(c.planInstalmentCents ?? 0)} by ${next}`,
          });
        });
        return 'promise_kept';
      }
      const body = await compose(
        run,
        'Thank the tenant for the payment they promised, and tell them the remaining balance still overdue; ask when they can pay it.',
      );
      await db.transaction(async (tx) => {
        await refreshBalance(run, tx);
        await send(run, tx, body, 'Promise kept, balance remains', ':kept');
        await transitionCase(tx, {
          organizationId: c.organizationId,
          caseId: c.id,
          to: 'REMINDED',
          actor: { type: 'agent' },
          reason: 'Promise kept; balance remains',
          patch: { lastReminderAt: run.now, promiseAmountCents: null, promiseDate: null },
          now: run.now,
        });
      });
      return 'promise_kept';
    }
    const body = await compose(
      run,
      `The payment the tenant promised (${formatNzd(c.promiseAmountCents)} by ${formatCalendarDate(c.promiseDate)}) has not arrived. Mention it kindly, ask what happened and when they can pay, and invite them to tell us if they are struggling.`,
    );
    await db.transaction(async (tx) => {
      await refreshBalance(run, tx);
      await send(run, tx, body, 'Promise not kept', ':broken');
      await transitionCase(tx, {
        organizationId: c.organizationId,
        caseId: c.id,
        to: 'REMINDED',
        actor: { type: 'agent' },
        reason: `Promise of ${formatNzd(c.promiseAmountCents ?? 0)} by ${c.promiseDate ?? ''} not kept`,
        patch: {
          remindersSent: c.remindersSent + 1,
          lastReminderAt: run.now,
          promiseAmountCents: null,
          promiseDate: null,
          planInstalmentCents: null,
          planFrequency: null,
        },
        now: run.now,
      });
    });
    return 'promise_broken';
  }

  if (c.state === 'REMINDED' && sinceReminder >= policy.reminderEveryDays) {
    if (pos.daysOverdue >= policy.noticeAtDays) {
      await db.transaction(async (tx) => {
        await refreshBalance(run, tx);
        must(
          await executeTool(
            requestNoticeApprovalTool,
            tc(run, tx, 'Arrears past notice threshold'),
            {
              reason: `${formatNzd(pos.balanceCents)} is ${String(pos.daysOverdue)} days overdue after ${String(c.remindersSent)} reminder(s) with no payment or kept promise.`,
            },
          ),
        );
      });
      return 'notice_requested';
    }
    if (c.remindersSent < policy.maxReminders) {
      const body = await compose(
        run,
        'Follow-up reminder: the rent is still overdue. Restate the amount, ask when they can pay or whether a short payment plan would help, and invite them to tell us if they are struggling.',
      );
      await db.transaction(async (tx) => {
        await refreshBalance(run, tx);
        await send(run, tx, body, 'Follow-up arrears reminder', `:r${String(c.remindersSent + 1)}`);
        await patchCase(tx, {
          organizationId: c.organizationId,
          caseId: c.id,
          patch: { remindersSent: c.remindersSent + 1, lastReminderAt: run.now },
          reason: `Reminder ${String(c.remindersSent + 1)}`,
        });
      });
      return 'reminded';
    }
  }
  await db.transaction((tx) => refreshBalance(run, tx));
  return 'waiting';
}

// ---------- Tenant replies ----------

async function handleReply(run: Run, msg: Message): Promise<ArrearsStep> {
  const { c } = run;
  const db = run.deps.db;
  if (c.state === 'ESCALATED') {
    // A person has the case; record the message, don't answer for them.
    await db.transaction((tx) => markProcessed(tx, msg));
    return 'ignored';
  }

  const out = await run.deps.llm.structured({
    ctx: { organizationId: c.organizationId, jobId: null, step: 'interpret.arrears' },
    system: INTERPRET_ARREARS_SYSTEM,
    user: [
      'Facts:',
      ...factLines(run),
      '',
      'Conversation so far:',
      await conversation(db, c),
      '',
      'Latest tenant message:',
      untrusted(msg.body, { from: 'tenant' }),
    ].join('\n'),
    schema: arrearsReplyOutput,
    effort: 'medium',
  });
  const sfx = `:m${msg.id}`;
  const decision = decideReply(out, run);

  if (decision.kind === 'escalate') {
    const holding = decision.reply
      ? await compose(run, decision.reply, [`Tenant said (summary): ${out.summary}`])
      : null;
    await db.transaction(async (tx) => {
      await markProcessed(tx, msg);
      await refreshBalance(run, tx);
      if (holding) await send(run, tx, holding, 'Holding reply before PM takes over', sfx);
      await escalate(run, tx, { ...decision.escalation, summary: out.summary }, sfx);
    });
    return 'escalated';
  }

  if (decision.kind === 'promise') {
    const confirm = await compose(run, decision.confirmPurpose);
    await db.transaction(async (tx) => {
      await markProcessed(tx, msg);
      await refreshBalance(run, tx);
      must(await executeTool(recordPromiseTool, tc(run, tx, decision.reason, sfx), decision.input));
      await send(run, tx, confirm, 'Confirm commitment', sfx);
    });
    return 'recorded_promise';
  }

  const answer = await compose(run, decision.purpose, [`Tenant said (summary): ${out.summary}`]);
  await db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    await refreshBalance(run, tx);
    await send(run, tx, answer, 'Answer tenant', sfx);
  });
  return 'answered';
}

type ReplyDecision =
  | {
      kind: 'escalate';
      reply: string | null;
      escalation: { reason: string; recommendation: string };
    }
  | {
      kind: 'promise';
      reason: string;
      confirmPurpose: string;
      input: {
        amountCents: number;
        date: string;
        plan: { instalmentCents: number; frequency: 'weekly' | 'fortnightly' } | null;
      };
    }
  | { kind: 'answer'; purpose: string };

function cents(nzd: string | null): number | null {
  if (!nzd) return null;
  try {
    const v = parseNzdToCents(nzd);
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** The policy, in code: what the agent may agree to on its own, and what goes to a person. */
export function decideReply(
  out: ArrearsReplyOutput,
  run: Pick<Run, 'policy' | 'pos' | 'today'>,
): ReplyDecision {
  const { policy, pos, today } = run;
  if (out.promptInjection) {
    return {
      kind: 'escalate',
      reply: null,
      escalation: {
        reason: 'suspected prompt injection in a rent reply',
        recommendation: 'Read the tenant’s message and reply personally; the agent sent nothing.',
      },
    };
  }
  if (out.hardshipOrSafety || out.intent === 'hardship') {
    return {
      kind: 'escalate',
      reply:
        'The tenant has told us about a difficult situation. Thank them for telling us, say there is no pressure right now and that their property manager will contact them personally to work something out. Do not mention amounts or deadlines.',
      escalation: {
        reason: 'tenant reported hardship or a safety concern',
        recommendation:
          'Call the tenant. Consider a hardship arrangement and point them to support (e.g. Work and Income); pause reminders.',
      },
    };
  }
  if (out.intent === 'dispute_amount' || out.intent === 'already_paid') {
    return {
      kind: 'escalate',
      reply:
        'The tenant says the amount is wrong or already paid. Thank them, say we will check the rent ledger with their property manager and come back to them. Do not repeat the demand.',
      escalation: {
        reason:
          out.intent === 'already_paid'
            ? 'tenant says rent is already paid'
            : 'tenant disputes the amount',
        recommendation:
          'Check the ledger and bank feed for unmatched payments, then reply to the tenant.',
      },
    };
  }
  if (out.distressedOrAngry) {
    return {
      kind: 'escalate',
      reply:
        'Acknowledge the tenant’s frustration calmly and say their property manager will be in touch personally.',
      escalation: {
        reason: 'tenant distressed or angry about arrears contact',
        recommendation: 'Call the tenant rather than messaging.',
      },
    };
  }

  if (out.intent === 'promise_to_pay') {
    const date = out.promiseDate;
    if (!date) {
      return {
        kind: 'answer',
        purpose:
          'The tenant intends to pay but gave no date. Thank them and ask which day they can pay.',
      };
    }
    const ahead = daysBetween(today, date);
    const amount = cents(out.promiseAmountNzd) ?? pos.balanceCents;
    if (ahead < 0 || ahead > policy.promiseMaxDaysAhead) {
      return {
        kind: 'escalate',
        reply:
          'Thank the tenant for the date they suggested and say their property manager will confirm whether that works.',
        escalation: {
          reason: `promise date ${date} is outside the ${String(policy.promiseMaxDaysAhead)}-day policy`,
          recommendation: 'Agree a date with the tenant or offer a payment plan.',
        },
      };
    }
    return {
      kind: 'promise',
      reason: `Promise to pay ${formatNzd(amount)} by ${date}`,
      confirmPurpose: `Confirm the tenant's promise to pay ${formatNzd(amount)} by ${formatCalendarDate(date)}. Thank them. If this is less than the ${formatNzd(pos.balanceCents)} overdue, say we will talk about the rest after.`,
      input: { amountCents: amount, date, plan: null },
    };
  }

  if (out.intent === 'payment_plan_request') {
    const instalment = cents(out.instalmentNzd);
    if (!instalment) {
      return {
        kind: 'answer',
        purpose: `The tenant asked for a payment plan but gave no amount. Say a plan is possible: ask how much extra they could pay each week on top of their usual rent, so the ${formatNzd(pos.balanceCents)} is cleared within ${String(policy.planMaxWeeks)} weeks.`,
      };
    }
    const frequency = out.instalmentFrequency ?? 'weekly';
    const perWeek = frequency === 'weekly' ? instalment : instalment / 2;
    const weeks = Math.ceil(pos.balanceCents / perWeek);
    const first =
      out.firstInstalmentDate && daysBetween(today, out.firstInstalmentDate) >= 0
        ? out.firstInstalmentDate
        : addDays(today, 7);
    if (weeks > policy.planMaxWeeks || daysBetween(today, first) > policy.promiseMaxDaysAhead) {
      return {
        kind: 'escalate',
        reply:
          'Thank the tenant for proposing a plan and say their property manager will look at it and confirm.',
        escalation: {
          reason: `plan of ${formatNzd(instalment)} ${frequency} takes ${String(weeks)} weeks (policy ${String(policy.planMaxWeeks)})`,
          recommendation:
            'Decide whether to accept the longer plan or propose a higher instalment.',
        },
      };
    }
    return {
      kind: 'promise',
      reason: `Payment plan ${formatNzd(instalment)} ${frequency}, ${String(weeks)} weeks`,
      confirmPurpose: `Confirm the payment plan: ${formatNzd(instalment)} ${frequency} on top of the usual rent, first payment by ${formatCalendarDate(first)}, clearing the ${formatNzd(pos.balanceCents)} in about ${String(weeks)} weeks. Thank them.`,
      input: {
        amountCents: instalment,
        date: first,
        plan: { instalmentCents: instalment, frequency },
      },
    };
  }

  return {
    kind: 'answer',
    purpose:
      'Answer the tenant’s question using only the facts (amount, due date, any commitment). If they asked something the facts do not cover, say their property manager will follow up.',
  };
}

async function loadInbound(db: DbOrTx, c: ArrearsCase, messageId: string) {
  const [msg] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, c.organizationId),
        eq(messages.arrearsCaseId, c.id),
        eq(messages.id, messageId),
      ),
    );
  return msg?.direction === 'inbound' ? msg : null;
}
