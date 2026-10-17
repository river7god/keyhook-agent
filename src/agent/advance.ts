import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db/client';
import { idempotencyKeys, messages, tradieAvailability } from '@/db/schema';
import { decideApproval, loadApprovalLimits } from '@/domain/approval-policy';
import { writeAudit } from '@/domain/audit';
import { withIdempotency } from '@/domain/idempotency';
import { getJob, patchJob, transitionJob, type Job } from '@/domain/jobs';
import { deliverQueued, type Message } from '@/domain/messages';
import { listFreeSlots } from '@/domain/tradie-selection';
import { formatNzd, parseNzdToCents } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { executeTool, type ToolResult } from '@/tools/execute';
import {
  addNoteTool,
  escalateTool,
  recordOfferedSlots,
  requestQuoteTool,
  scheduleVisitTool,
  sendMessageTool,
} from '@/tools/action-tools';
import { getPropertyTool, listJobsForPropertyTool, searchTradiesTool } from '@/tools/read-tools';
import { toAnthropicTool, type AnyTool, type ToolContext } from '@/tools/types';
import { loadJobContext, renderJobContext, type JobContext } from './context';
import type { LlmClient } from './llm';
import { decideTriage } from './policy';
import {
  ACT_TRIAGED_SYSTEM,
  COMPOSE_TENANT_SYSTEM,
  INTERPRET_SYSTEM,
  TRIAGE_SYSTEM,
} from './prompts';
import {
  composeOutput,
  confirmationReplyOutput,
  progressReplyOutput,
  quoteReplyOutput,
  slotReplyOutput,
  triageOutput,
} from './schemas';
import { untrusted } from './untrusted';

export interface AgentDeps {
  db: Db;
  llm: LlmClient;
  now: () => Date;
}

type StepResult = 'continue' | 'wait';

const MAX_STEPS = 6;
const MAX_TOOL_TURNS = 8;
const SLOTS_OFFERED = 3;
const GST_RATE = 0.15;

/**
 * Advance one job as far as it can go without outside input. Called by the Inngest orchestrator
 * when a job is created or a tenant/tradie message arrives (serialised per job).
 *
 * Each handler does its LLM work first, then applies all effects in ONE transaction through
 * executeTool (permissions, idempotency, audit). Queued messages are delivered after commit.
 */
export async function advanceJob(
  deps: AgentDeps,
  args: { organizationId: string; jobId: string; messageId?: string | null },
): Promise<{ handled: string[] }> {
  const handled: string[] = [];
  let pending: Message | null = args.messageId
    ? await loadInbound(deps.db, args.organizationId, args.jobId, args.messageId)
    : null;

  for (let i = 0; i < MAX_STEPS; i++) {
    const job = await getJob(deps.db, args.organizationId, args.jobId);
    const step = pickHandler(job, pending);
    if (!step) break;
    handled.push(step.name);
    const result = await step.run(deps, job, pending);
    pending = null; // an inbound message is consumed by at most one handler
    if (result === 'wait') break;
  }

  await deliverQueued(deps.db, args.organizationId, args.jobId);
  return { handled };
}

type Handler = {
  name: string;
  run: (deps: AgentDeps, job: Job, msg: Message | null) => Promise<StepResult>;
};

function pickHandler(job: Job, msg: Message | null): Handler | null {
  if (msg) {
    const fromTenant = msg.senderType === 'tenant' && msg.senderId === job.reportedByTenantId;
    const fromTradie = msg.senderType === 'tradie' && msg.senderId === job.assignedTradieId;
    if (job.state === 'AWAITING_QUOTE' && fromTradie)
      return { name: 'quote_reply', run: withMsg(handleQuoteReply) };
    if (job.state === 'SCHEDULING' && fromTenant)
      return { name: 'slot_reply', run: withMsg(handleSlotReply) };
    if ((job.state === 'SCHEDULED' || job.state === 'IN_PROGRESS') && fromTradie) {
      return { name: 'progress_reply', run: withMsg(handleProgressReply) };
    }
    if (job.state === 'AWAITING_CONFIRMATION' && fromTenant) {
      return { name: 'confirmation_reply', run: withMsg(handleConfirmationReply) };
    }
    // RECEIVED jobs are triaged with the message as context; anything else is noted for the PM.
    if (job.state !== 'RECEIVED')
      return { name: 'unhandled_message', run: withMsg(handleUnhandled) };
  }
  if (job.state === 'RECEIVED') return { name: 'triage', run: handleReceived };
  if (job.state === 'TRIAGED') return { name: 'arrange_quote', run: handleTriaged };
  return null;
}

function withMsg(fn: (deps: AgentDeps, job: Job, msg: Message) => Promise<StepResult>) {
  return (deps: AgentDeps, job: Job, msg: Message | null) => {
    if (!msg) throw new Error('handler requires a message');
    return fn(deps, job, msg);
  };
}

// ── RECEIVED → TRIAGED | ESCALATED ─────────────────────────────────────────────────────────────

async function handleReceived(deps: AgentDeps, job: Job): Promise<StepResult> {
  const ctx = await loadJobContext(deps.db, job);
  const triage = await deps.llm.structured({
    ctx: llmCtx(job, 'triage'),
    system: TRIAGE_SYSTEM,
    user: await renderJobContext(deps.db, ctx),
    schema: triageOutput,
    effort: 'medium',
  });
  const decision = decideTriage(triage);
  const patch = {
    title: triage.title.slice(0, 120),
    urgency: triage.urgency,
    trade: triage.trade,
    triageConfidence: Math.min(1, Math.max(0, triage.confidence)),
  };

  await deps.db.transaction(async (tx) => {
    const tc = toolCtx(tx, job, 'Triage', deps.now());
    await writeAudit(tx, {
      organizationId: job.organizationId,
      jobId: job.id,
      actorType: 'agent',
      action: 'agent.triage',
      reason: decision.action === 'proceed' ? 'Triage passed policy' : decision.reasons.join('; '),
      output: { triage, decision },
      outcome: 'ok',
    });
    if (decision.action === 'proceed') {
      await transitionJob(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        to: 'TRIAGED',
        actor: { type: 'agent' },
        reason: `Triaged as ${triage.urgency} ${triage.trade} (confidence ${patch.triageConfidence.toFixed(2)})`,
        patch,
      });
    } else {
      await patchJob(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        actor: { type: 'agent' },
        reason: 'Record triage before escalation',
        patch,
      });
      must(
        await executeTool(escalateTool, tc, {
          reason: decision.reasons.join('; '),
          summary: triage.summary,
          whatHasBeenDone: 'Triaged the request and acknowledged the tenant.',
          recommendation: decision.recommendation,
        }),
      );
    }
    if (ctx.tenant && !triage.flags.promptInjection) {
      must(
        await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: triage.tenantReply }),
      );
    }
  });
  return decision.action === 'proceed' ? 'continue' : 'wait';
}

// ── TRIAGED → AWAITING_QUOTE | ESCALATED (constrained tool loop) ───────────────────────────────

const TRIAGED_TOOLS: AnyTool[] = [
  searchTradiesTool,
  getPropertyTool,
  listJobsForPropertyTool,
  requestQuoteTool,
  escalateTool,
];

async function handleTriaged(deps: AgentDeps, job: Job): Promise<StepResult> {
  const ctx = await loadJobContext(deps.db, job);
  const tools = TRIAGED_TOOLS.map(toAnthropicTool);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: `${await renderJobContext(deps.db, ctx)}\n\nArrange a quote for this job now.`,
    },
  ];
  const callCounts = new Map<string, number>();

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await deps.llm.toolTurn({
      ctx: llmCtx(job, 'act.triaged'),
      system: ACT_TRIAGED_SYSTEM,
      messages,
      tools,
      effort: 'medium',
    });
    messages.push({ role: 'assistant', content: response.content });
    const uses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );
    if (uses.length === 0) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const tool = TRIAGED_TOOLS.find((t) => t.name === use.name);
      let result: ToolResult;
      if (!tool) {
        result = { ok: false, error: { code: 'NOT_FOUND', message: `Unknown tool ${use.name}` } };
      } else {
        const n = callCounts.get(tool.name) ?? 0;
        callCounts.set(tool.name, n + 1);
        result = await deps.db.transaction((tx) =>
          executeTool(tool, toolCtx(tx, job, 'Arrange quote', deps.now()), use.input, n),
        );
      }
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result.ok ? result.output : { error: result.error }),
        is_error: !result.ok,
      });
    }
    // All results for one assistant turn go back in a single user message.
    messages.push({ role: 'user', content: results });

    const current = await getJob(deps.db, job.organizationId, job.id);
    if (current.state !== 'TRIAGED') break;
  }

  // Check our own work: the step must end in AWAITING_QUOTE or ESCALATED.
  const after = await getJob(deps.db, job.organizationId, job.id);
  if (after.state === 'TRIAGED') {
    await deps.db.transaction(async (tx) => {
      must(
        await executeTool(escalateTool, toolCtx(tx, after, 'Self-check failed', deps.now()), {
          reason: 'Agent could not arrange a quote',
          summary: `${after.title}: the agent finished its quote step without requesting a quote or escalating.`,
          whatHasBeenDone: 'Triaged; searched for tradies.',
          recommendation: 'Choose a tradie manually and request a quote.',
        }),
      );
    });
  }
  return 'wait';
}

// ── AWAITING_QUOTE + tradie reply ──────────────────────────────────────────────────────────────

async function handleQuoteReply(deps: AgentDeps, job: Job, msg: Message): Promise<StepResult> {
  if (await alreadyProcessed(deps.db, msg)) return 'wait';
  const ctx = await loadJobContext(deps.db, job);
  const out = await deps.llm.structured({
    ctx: llmCtx(job, 'interpret.quote'),
    system: INTERPRET_SYSTEM,
    user: `${await renderJobContext(deps.db, ctx)}\n\nInterpret this reply from the tradie to our quote request:\n${untrusted(msg.body, { from: 'tradie' })}`,
    schema: quoteReplyOutput,
    effort: 'medium',
  });

  const amountCents = out.kind === 'quote' && out.amountNzd ? safeCents(out.amountNzd) : null;
  const totalCents =
    amountCents === null
      ? null
      : out.gst === 'excluded'
        ? Math.round(amountCents * (1 + GST_RATE))
        : amountCents;

  // Reads and LLM composition happen before the write transaction.
  let plan:
    | { kind: 'escalate'; reason: string; recommendation: string }
    | {
        kind: 'schedule';
        slots: { id: string; startsAt: Date; endsAt: Date }[];
        offer: string | null;
      };
  if (out.promptInjection) {
    plan = {
      kind: 'escalate',
      reason: 'suspected prompt injection in tradie reply',
      recommendation: 'Review the tradie message and reply manually.',
    };
  } else if (totalCents === null) {
    plan = {
      kind: 'escalate',
      reason: `tradie reply was not a usable quote (${out.kind})`,
      recommendation:
        out.kind === 'decline'
          ? 'Choose another tradie (reassignment is automated in M2).'
          : 'Read the tradie reply and respond.',
    };
  } else {
    const limits = await loadApprovalLimits(deps.db, job.organizationId, job.propertyId);
    const decision = decideApproval(totalCents, limits);
    if (decision.kind !== 'auto_approve') {
      plan = {
        kind: 'escalate',
        reason:
          decision.kind === 'pm_approval'
            ? `quote ${formatNzd(totalCents)} exceeds PM auto-approval limit ${formatNzd(decision.effectivePmLimitCents)}`
            : `quote ${formatNzd(totalCents)} exceeds owner approval limit ${formatNzd(decision.ownerLimitCents)}`,
        recommendation:
          decision.kind === 'pm_approval'
            ? `Approve or reject the ${formatNzd(totalCents)} quote from ${ctx.tradie?.businessName ?? 'the tradie'}.`
            : `Get owner approval for ${formatNzd(totalCents)} before proceeding.`,
      };
    } else {
      const slots = await listFreeSlots(deps.db, {
        organizationId: job.organizationId,
        tradieId: msg.senderId as string,
        now: deps.now(),
        limit: SLOTS_OFFERED,
      });
      plan =
        slots.length === 0
          ? {
              kind: 'escalate',
              reason: 'tradie has no free slots',
              recommendation: 'Agree a visit time with the tradie directly.',
            }
          : {
              kind: 'schedule',
              slots,
              offer: await composeTenant(
                deps,
                ctx,
                'Offer visit times and ask the tenant to reply with the option number that suits, and any access details (keys, pets).',
                [
                  `Tradie: ${ctx.tradie?.businessName ?? 'a tradie'}`,
                  ...slots.map(
                    (s, i) =>
                      `Option ${i + 1}: ${formatNzDateTime(s.startsAt)} – ${formatNzDateTime(s.endsAt)}`,
                  ),
                ],
              ),
            };
    }
  }

  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Process tradie quote', deps.now());
    if (totalCents !== null) {
      await patchJob(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        actor: { type: 'agent' },
        reason: `Quote received${out.gst === 'excluded' ? ' (GST added)' : out.gst === 'unknown' ? ' (GST status unclear; treated as inclusive)' : ''}`,
        patch: { estimateCents: totalCents },
      });
    }
    if (plan.kind === 'escalate') {
      must(
        await executeTool(escalateTool, tc, {
          reason: plan.reason,
          summary: `${job.title}. Tradie replied: ${out.notes || out.kind}`,
          whatHasBeenDone: 'Triaged, requested a quote, received a reply.',
          recommendation: plan.recommendation,
        }),
      );
      return;
    }
    await transitionJob(tx, {
      organizationId: job.organizationId,
      jobId: job.id,
      to: 'SCHEDULING',
      actor: { type: 'agent' },
      reason: `Quote ${formatNzd(totalCents as number)} within auto-approval limit`,
    });
    await recordOfferedSlots(
      tx,
      job.organizationId,
      job.id,
      plan.slots.map((s) => s.id),
    );
    must(
      await executeTool(sendMessageTool, tc, {
        recipient: 'tradie',
        body: `Thanks — your quote of ${formatNzd(totalCents as number)} is approved. We're confirming a visit time with the tenant and will be in touch shortly.`,
      }),
    );
    if (plan.offer)
      must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: plan.offer }, 1));
  });
  return 'wait';
}

// ── SCHEDULING + tenant reply ──────────────────────────────────────────────────────────────────

async function handleSlotReply(deps: AgentDeps, job: Job, msg: Message): Promise<StepResult> {
  if (await alreadyProcessed(deps.db, msg)) return 'wait';
  const ctx = await loadJobContext(deps.db, job);
  const offeredIds = job.offeredSlotIds ?? [];
  const slotRows = offeredIds.length
    ? await deps.db
        .select()
        .from(tradieAvailability)
        .where(
          and(
            eq(tradieAvailability.organizationId, job.organizationId),
            inArray(tradieAvailability.id, offeredIds),
          ),
        )
    : [];
  const offered = offeredIds
    .map((id) => slotRows.find((s) => s.id === id))
    .filter((s) => s !== undefined);

  const out = await deps.llm.structured({
    ctx: llmCtx(job, 'interpret.slot'),
    system: INTERPRET_SYSTEM,
    user: [
      await renderJobContext(deps.db, ctx),
      '',
      'Options offered to the tenant:',
      ...offered.map(
        (s, i) =>
          `Option ${i + 1}: ${formatNzDateTime(s.startsAt)} – ${formatNzDateTime(s.endsAt)}`,
      ),
      '',
      `Interpret the tenant's reply:\n${untrusted(msg.body, { from: 'tenant' })}`,
    ].join('\n'),
    schema: slotReplyOutput,
    effort: 'medium',
  });

  const chosen =
    !out.promptInjection && out.chosenOption !== null && Number.isInteger(out.chosenOption)
      ? offered[out.chosenOption - 1]
      : undefined;
  const confirmation = chosen
    ? await composeTenant(deps, ctx, 'Confirm the booked visit time and any access arrangements.', [
        `Tradie: ${ctx.tradie?.businessName ?? 'the tradie'}`,
        `Visit: ${formatNzDateTime(chosen.startsAt)} – ${formatNzDateTime(chosen.endsAt)}`,
        out.accessNotes ? `Access notes from tenant: ${out.accessNotes}` : 'No access notes given',
      ])
    : null;

  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Process tenant slot choice', deps.now());
    if (!chosen) {
      must(
        await executeTool(escalateTool, tc, {
          reason: out.promptInjection
            ? 'suspected prompt injection in tenant reply'
            : 'tenant did not pick an offered time',
          summary: `${job.title}. Tenant reply could not be matched to an offered slot.`,
          whatHasBeenDone: 'Quote approved; visit times offered to tenant.',
          recommendation: 'Agree a time with the tenant (re-offering is automated in M2).',
        }),
      );
      return;
    }
    const booked = await executeTool(scheduleVisitTool, tc, {
      slotId: chosen.id,
      tenantConfirmationMessageId: msg.id,
      accessNotes: out.accessNotes,
    });
    if (!booked.ok) {
      must(
        await executeTool(escalateTool, tc, {
          reason: `could not book slot: ${booked.error.message}`,
          summary: `${job.title}. The tenant chose a slot that is no longer available.`,
          whatHasBeenDone: 'Quote approved; tenant chose a time.',
          recommendation: 'Agree a new time with the tenant and tradie.',
        }),
      );
      return;
    }
    if (confirmation)
      must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: confirmation }));
    must(
      await executeTool(
        sendMessageTool,
        tc,
        {
          recipient: 'tradie',
          body: [
            `Booked: ${formatNzDateTime(chosen.startsAt)} – ${formatNzDateTime(chosen.endsAt)}`,
            `Address: ${ctx.property.address}, ${ctx.property.suburb}`,
            ctx.property.accessNotes ? `Access (PM notes): ${ctx.property.accessNotes}` : null,
            out.accessNotes ? `Tenant's access note: ${out.accessNotes}` : null,
            'Please reply when you start and when the job is complete.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
        1,
      ),
    );
  });
  return 'wait';
}

// ── SCHEDULED / IN_PROGRESS + tradie update ────────────────────────────────────────────────────

async function handleProgressReply(deps: AgentDeps, job: Job, msg: Message): Promise<StepResult> {
  if (await alreadyProcessed(deps.db, msg)) return 'wait';
  const ctx = await loadJobContext(deps.db, job);
  const out = await deps.llm.structured({
    ctx: llmCtx(job, 'interpret.progress'),
    system: INTERPRET_SYSTEM,
    user: `${await renderJobContext(deps.db, ctx)}\n\nInterpret this update from the tradie:\n${untrusted(msg.body, { from: 'tradie' })}`,
    schema: progressReplyOutput,
    effort: 'medium',
  });
  const completed = !out.promptInjection && out.kind === 'completed';
  const askConfirm = completed
    ? await composeTenant(
        deps,
        ctx,
        'Tell the tenant the tradie reports the job is complete and ask them to reply to confirm the issue is fixed.',
        [
          `Tradie: ${ctx.tradie?.businessName ?? 'the tradie'}`,
          out.notes ? `Tradie's notes: ${out.notes}` : 'No notes',
        ],
      )
    : null;

  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Process tradie update', deps.now());
    const move = (to: 'IN_PROGRESS' | 'AWAITING_CONFIRMATION', reason: string) =>
      transitionJob(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        to,
        actor: { type: 'agent' },
        reason,
      });

    if (!out.promptInjection && out.kind === 'started' && job.state === 'SCHEDULED') {
      await move('IN_PROGRESS', 'Tradie reported work started');
      return;
    }
    if (completed) {
      if (job.state === 'SCHEDULED')
        await move('IN_PROGRESS', 'Tradie reported completion (start implied)');
      await move('AWAITING_CONFIRMATION', 'Tradie reported completion');
      if (askConfirm)
        must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: askConfirm }));
      return;
    }
    must(
      await executeTool(escalateTool, tc, {
        reason: out.promptInjection
          ? 'suspected prompt injection in tradie update'
          : `tradie update needs a person (${out.kind})`,
        summary: `${job.title}. Tradie said: ${out.notes || out.kind}`,
        whatHasBeenDone: 'Visit booked.',
        recommendation: 'Contact the tradie (delay handling is automated in M2).',
      }),
    );
  });
  return 'wait';
}

// ── AWAITING_CONFIRMATION + tenant reply ───────────────────────────────────────────────────────

async function handleConfirmationReply(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<StepResult> {
  if (await alreadyProcessed(deps.db, msg)) return 'wait';
  const ctx = await loadJobContext(deps.db, job);
  const out = await deps.llm.structured({
    ctx: llmCtx(job, 'interpret.confirmation'),
    system: INTERPRET_SYSTEM,
    user: `${await renderJobContext(deps.db, ctx)}\n\nDoes the tenant confirm the issue is fixed?\n${untrusted(msg.body, { from: 'tenant' })}`,
    schema: confirmationReplyOutput,
    effort: 'medium',
  });
  const confirmed = !out.promptInjection && out.confirmed === 'yes';
  const thanks = confirmed
    ? await composeTenant(
        deps,
        ctx,
        'Thank the tenant, confirm the job is closed, and invite them to report any future issues.',
        [],
      )
    : null;

  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Process tenant confirmation', deps.now());
    if (!confirmed) {
      must(
        await executeTool(escalateTool, tc, {
          reason: out.promptInjection
            ? 'suspected prompt injection in tenant reply'
            : `tenant did not confirm completion (${out.confirmed})`,
          summary: `${job.title}. Tenant said: ${out.notes || out.confirmed}`,
          whatHasBeenDone: 'Tradie reported the job complete.',
          recommendation: 'Check with the tenant and tradie whether a return visit is needed.',
        }),
      );
      return;
    }
    await transitionJob(tx, {
      organizationId: job.organizationId,
      jobId: job.id,
      to: 'CLOSED',
      actor: { type: 'agent' },
      reason: 'Tenant confirmed the issue is fixed',
    });
    if (thanks) must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: thanks }));
    must(
      await executeTool(
        sendMessageTool,
        tc,
        {
          recipient: 'tradie',
          body: 'The tenant has confirmed the job is complete — thanks. This job is now closed.',
        },
        1,
      ),
    );
  });
  return 'wait';
}

// ── Messages the M1 flow does not act on ───────────────────────────────────────────────────────

async function handleUnhandled(deps: AgentDeps, job: Job, msg: Message): Promise<StepResult> {
  if (await alreadyProcessed(deps.db, msg)) return 'wait';
  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    must(
      await executeTool(addNoteTool, toolCtx(tx, job, 'Unhandled message', deps.now()), {
        text: `Message from ${msg.senderType} while job is ${job.state} was not acted on automatically (handled from M2). PM may need to reply.`,
      }),
    );
  });
  return 'wait';
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────

function llmCtx(job: Job, step: string) {
  return { organizationId: job.organizationId, jobId: job.id, step };
}

function toolCtx(db: DbOrTx, job: Job, reason: string, now: Date): ToolContext {
  return {
    db,
    organizationId: job.organizationId,
    jobId: job.id,
    reason,
    idempotencyScope: `${job.id}:v${job.version}`,
    now,
  };
}

/** Workflow-driven tool calls must succeed; a failure aborts the transaction (Inngest retries). */
function must(result: ToolResult): unknown {
  if (!result.ok) throw new Error(`Tool failed: ${result.error.code} ${result.error.message}`);
  return result.output;
}

function safeCents(amount: string): number | null {
  try {
    return parseNzdToCents(amount);
  } catch {
    return null;
  }
}

async function composeTenant(
  deps: AgentDeps,
  ctx: JobContext,
  purpose: string,
  facts: string[],
): Promise<string | null> {
  if (!ctx.tenant) return null;
  const out = await deps.llm.structured({
    ctx: llmCtx(ctx.job, 'compose.tenant'),
    system: COMPOSE_TENANT_SYSTEM,
    user: [
      `Tenant first name: ${ctx.tenant.fullName.split(' ')[0] ?? ctx.tenant.fullName}`,
      `Preferred language: ${ctx.tenant.preferredLanguage}`,
      `Job: ${ctx.job.title}`,
      `Purpose: ${purpose}`,
      'Facts:',
      ...(facts.length ? facts.map((f) => `- ${f}`) : ['- (none beyond the purpose)']),
    ].join('\n'),
    schema: composeOutput,
    effort: 'low',
  });
  return out.body.trim();
}

const inboundKey = (msg: Message) => `inbound:${msg.id}`;

async function loadInbound(db: Db, organizationId: string, jobId: string, messageId: string) {
  const [msg] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.jobId, jobId),
        eq(messages.id, messageId),
      ),
    );
  return msg && msg.direction === 'inbound' ? msg : null;
}

async function alreadyProcessed(db: Db, msg: Message): Promise<boolean> {
  const [row] = await db
    .select({ key: idempotencyKeys.key })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.organizationId, msg.organizationId),
        eq(idempotencyKeys.key, inboundKey(msg)),
      ),
    );
  return row !== undefined;
}

/** An inbound message is acted on at most once, even if the orchestrator retries. */
async function markProcessed(tx: DbOrTx, msg: Message): Promise<void> {
  await withIdempotency(
    tx,
    {
      organizationId: msg.organizationId,
      key: inboundKey(msg),
      tool: 'process_inbound',
      request: { messageId: msg.id },
    },
    () => Promise.resolve({ processed: true }),
  );
}
