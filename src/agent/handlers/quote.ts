import type Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { properties, tradies } from '@/db/schema';
import { decideApproval, loadApprovalLimits } from '@/domain/approval-policy';
import { writeAudit } from '@/domain/audit';
import { loadWorkflowPolicy } from '@/domain/follow-ups';
import { getJob, patchJob, transitionJob, type Job } from '@/domain/jobs';
import type { Message } from '@/domain/messages';
import { formatNzd, parseNzdToCents } from '@/lib/money';
import { escalateTool, requestQuoteTool, sendMessageTool } from '@/tools/action-tools';
import { requestApprovalTool } from '@/tools/approval-tools';
import { executeTool, type ToolResult } from '@/tools/execute';
import {
  getPropertyTool,
  listJobsForPropertyTool,
  rankedTradiesForJob,
  searchTradiesTool,
} from '@/tools/read-tools';
import { toAnthropicTool, type AnyTool } from '@/tools/types';
import { loadJobContext, renderJobContext } from '../context';
import { ACT_TRIAGED_SYSTEM, INTERPRET_SYSTEM } from '../prompts';
import { quoteReplyOutput } from '../schemas';
import { untrusted } from '../untrusted';
import {
  composeTenant,
  escalate,
  GST_RATE,
  llmCtx,
  markProcessed,
  must,
  toolCtx,
  type AgentDeps,
  type StepResult,
} from './shared';

const MAX_TOOL_TURNS = 8;
const TRIAGED_TOOLS: AnyTool[] = [
  searchTradiesTool,
  getPropertyTool,
  listJobsForPropertyTool,
  requestQuoteTool,
  escalateTool,
];

/** TRIAGED → AWAITING_QUOTE | ESCALATED via a constrained, self-checked tool loop. */
export async function handleTriaged(deps: AgentDeps, job: Job): Promise<StepResult> {
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
    if ((await getJob(deps.db, job.organizationId, job.id)).state !== 'TRIAGED') break;
  }

  // Check our own work: the step must end in AWAITING_QUOTE or ESCALATED.
  const after = await getJob(deps.db, job.organizationId, job.id);
  if (after.state === 'TRIAGED') {
    await deps.db.transaction(async (tx) => {
      await escalate(toolCtx(tx, after, 'Self-check failed', deps.now()), {
        reason: 'Agent could not arrange a quote',
        summary: `${after.title}: the agent finished its quote step without requesting a quote or escalating.`,
        whatHasBeenDone: 'Triaged; searched for tradies.',
        recommendation: 'Choose a tradie manually and request a quote.',
      });
    });
  }
  // Milestone update (spec §12 R6): tell the tenant a supplier has been engaged.
  if (after.state === 'AWAITING_QUOTE') {
    const update = await composeTenant(
      deps,
      await loadJobContext(deps.db, after),
      'Let the tenant know a tradesperson has been asked to look at the job and that visit times will follow.',
      [`Trade: ${after.trade ?? 'maintenance'}`, 'Do not name the tradie or mention prices.'],
    );
    if (update) {
      await deps.db.transaction(async (tx) => {
        must(
          await executeTool(
            sendMessageTool,
            toolCtx(tx, after, 'Milestone: quote requested', deps.now(), ':milestone'),
            {
              recipient: 'tenant',
              body: update,
            },
          ),
        );
      });
    }
  }
  return 'wait';
}

/** AWAITING_QUOTE + reply from the assigned tradie. */
export async function handleQuoteReply(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<StepResult> {
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
  const approval =
    totalCents === null || out.promptInjection
      ? null
      : decideApproval(
          totalCents,
          await loadApprovalLimits(deps.db, job.organizationId, job.propertyId),
        );
  const tradieName = ctx.tradie?.businessName ?? 'the tradie';
  const awaitingApprovalUpdate =
    approval?.kind === 'pm_approval'
      ? await composeTenant(
          deps,
          ctx,
          'Let the tenant know the repair has been quoted and is with the property manager for approval; times will follow once approved.',
          ['Do not mention any amounts.'],
        )
      : null;

  let result: StepResult = 'wait';
  await deps.db.transaction(async (tx) => {
    await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Process tradie quote', deps.now(), `:m${msg.id}`);

    if (out.promptInjection) {
      await escalate(tc, {
        reason: 'suspected prompt injection in tradie reply',
        summary: `${job.title}. The tradie's reply contained instructions aimed at the agent.`,
        whatHasBeenDone: 'Requested a quote.',
        recommendation: 'Review the tradie message and reply manually.',
      });
      return;
    }
    if (out.kind === 'decline') {
      await reassignTradie(
        tx,
        deps,
        job,
        `${tradieName} declined: ${out.notes || 'no reason given'}`,
        false,
        `:m${msg.id}`,
      );
      return;
    }
    if (totalCents === null || !approval) {
      await escalate(tc, {
        reason: `tradie reply was not a usable quote (${out.kind})`,
        summary: `${job.title}. ${tradieName} replied: ${out.notes || out.kind}`,
        whatHasBeenDone: 'Requested a quote and received a reply that needs a person.',
        recommendation: 'Read the tradie reply and respond.',
      });
      return;
    }

    await patchJob(tx, {
      organizationId: job.organizationId,
      jobId: job.id,
      actor: { type: 'agent' },
      reason: `Quote received from ${tradieName}${out.gst === 'excluded' ? ' (GST added)' : out.gst === 'unknown' ? ' (GST status unclear; treated as inclusive)' : ''}`,
      patch: { estimateCents: totalCents },
    });

    if (approval.kind === 'auto_approve') {
      await transitionJob(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        to: 'SCHEDULING',
        actor: { type: 'agent' },
        reason: `Quote ${formatNzd(totalCents)} within auto-approval limit ${formatNzd(approval.effectivePmLimitCents)}`,
      });
      must(
        await executeTool(sendMessageTool, tc, {
          recipient: 'tradie',
          body: `Thanks — your quote of ${formatNzd(totalCents)} is approved. We're confirming a visit time with the tenant and will be in touch shortly.`,
        }),
      );
      result = 'continue'; // offer slots next
      return;
    }
    if (approval.kind === 'pm_approval') {
      must(
        await executeTool(requestApprovalTool, tc, {
          amountCents: totalCents,
          reason: `Quote ${formatNzd(totalCents)} from ${tradieName} exceeds PM auto-approval limit ${formatNzd(approval.effectivePmLimitCents)} (owner limit ${formatNzd(approval.ownerLimitCents)})`,
        }),
      );
      must(
        await executeTool(sendMessageTool, tc, {
          recipient: 'tradie',
          body: `Thanks for the quote of ${formatNzd(totalCents)}. It's with the property manager for approval — we'll be in touch as soon as it's approved.`,
        }),
      );
      if (awaitingApprovalUpdate) {
        must(
          await executeTool(
            sendMessageTool,
            tc,
            { recipient: 'tenant', body: awaitingApprovalUpdate },
            1,
          ),
        );
      }
      return;
    }
    await escalate(tc, {
      reason: `quote ${formatNzd(totalCents)} exceeds owner approval limit ${formatNzd(approval.ownerLimitCents)}`,
      summary: `${job.title}. ${tradieName} quoted ${formatNzd(totalCents)}.`,
      whatHasBeenDone: 'Triaged, requested and received a quote.',
      recommendation: `Get owner approval for ${formatNzd(totalCents)} before proceeding.`,
    });
  });
  return result;
}

/**
 * Move the job to the next eligible tradie (spec §7: escalate only when none is available).
 * Previous tradies are excluded for good. Runs inside the caller's transaction.
 */
export async function reassignTradie(
  tx: DbOrTx,
  deps: AgentDeps,
  job: Job,
  reason: string,
  notifyPrevious: boolean,
  scopeSuffix = '',
): Promise<'reassigned' | 'escalated'> {
  const policy = await loadWorkflowPolicy(tx, job.organizationId);
  const previous = job.assignedTradieId;
  const excluded = [...new Set([...job.excludedTradieIds, ...(previous ? [previous] : [])])];
  const tc = toolCtx(tx, job, 'Reassign tradie', deps.now(), scopeSuffix);

  await patchJob(tx, {
    organizationId: job.organizationId,
    jobId: job.id,
    actor: { type: 'agent' },
    reason,
    patch: { excludedTradieIds: excluded },
  });
  const ranked =
    excluded.length >= policy.quote.maxTradiesTried
      ? null
      : await rankedTradiesForJob(tx, job.organizationId, job.id, deps.now());
  const next = ranked?.selectableTradieIds[0];
  if (!next) {
    await escalate(tc, {
      reason: ranked
        ? 'no alternative tradie available'
        : `tried ${excluded.length} tradies without a quote`,
      summary: `${job.title}. ${reason}.`,
      whatHasBeenDone: `Requested quotes from ${excluded.length} tradie(s).`,
      recommendation: 'Find a tradie manually (or widen the tradie list for this suburb/trade).',
    });
    return 'escalated';
  }

  const [property] = await tx
    .select({ suburb: properties.suburb })
    .from(properties)
    .where(
      and(eq(properties.organizationId, job.organizationId), eq(properties.id, job.propertyId)),
    );
  const [tradie] = await tx
    .select({ contactName: tradies.contactName, businessName: tradies.businessName })
    .from(tradies)
    .where(and(eq(tradies.organizationId, job.organizationId), eq(tradies.id, next)));

  if (previous && notifyPrevious) {
    must(
      await executeTool(
        sendMessageTool,
        tc,
        {
          recipient: 'tradie',
          body: "We've arranged another tradie for this job — no action needed. Thanks.",
        },
        0,
      ),
    );
  }
  await patchJob(tx, {
    organizationId: job.organizationId,
    jobId: job.id,
    actor: { type: 'agent' },
    reason: `Reassigned to ${tradie?.businessName ?? next}`,
    patch: { assignedTradieId: next },
  });
  must(
    await executeTool(
      sendMessageTool,
      tc,
      {
        recipient: 'tradie',
        body: `Hi ${tradie?.contactName.split(' ')[0] ?? 'there'}, we have a ${job.urgency ?? ''} ${job.trade ?? ''} job in ${property?.suburb ?? 'Wellington'}: ${job.summary ?? job.title}. Could you reply with a quote (incl. GST) and your availability?`.replace(
          /\s+/g,
          ' ',
        ),
      },
      1,
    ),
  );
  await writeAudit(tx, {
    organizationId: job.organizationId,
    jobId: job.id,
    actorType: 'agent',
    action: 'agent.reassign',
    reason,
    output: { from: previous, to: next, excluded },
    outcome: 'ok',
  });
  return 'reassigned';
}

function safeCents(amount: string): number | null {
  try {
    return parseNzdToCents(amount);
  } catch {
    return null;
  }
}
