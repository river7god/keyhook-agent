import { writeAudit } from '@/domain/audit';
import { loadWorkflowPolicy } from '@/domain/follow-ups';
import { patchJob, transitionJob, type Job } from '@/domain/jobs';
import type { Message } from '@/domain/messages';
import { sendMessageTool } from '@/tools/action-tools';
import { executeTool } from '@/tools/execute';
import { loadJobContext, renderJobContext } from '../context';
import { decideTriage } from '../policy';
import { TRIAGE_SYSTEM } from '../prompts';
import { triageOutput } from '../schemas';
import {
  escalate,
  llmCtx,
  markProcessed,
  must,
  toolCtx,
  type AgentDeps,
  type StepResult,
} from './shared';

/**
 * RECEIVED: first triage. A job a PM handed back after a triage escalation is not re-triaged:
 * the PM's review covers the original flags, so the recorded (or PM-corrected) urgency/trade
 * are accepted. A new tenant message is still triaged normally.
 */
export async function handleReceived(
  deps: AgentDeps,
  job: Job,
  msg: Message | null,
): Promise<StepResult> {
  if (job.pmReviewedAt && job.urgency && job.trade && !msg) {
    await deps.db.transaction((tx) =>
      transitionJob(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        to: 'TRIAGED',
        actor: { type: 'agent' },
        reason: `Triage accepted by PM review (${job.urgency ?? ''} ${job.trade ?? ''})`,
      }),
    );
    return 'continue';
  }
  return triage(deps, job, msg);
}

/** NEEDS_INFO + tenant reply: re-triage with the whole conversation. */
export function handleClarifyReply(deps: AgentDeps, job: Job, msg: Message): Promise<StepResult> {
  return triage(deps, job, msg);
}

/**
 * Triage (or re-triage) → proceed to TRIAGED, ask a clarifying question (NEEDS_INFO), or escalate.
 * The state machine only allows NEEDS_INFO from TRIAGED, so clarifying goes X → TRIAGED → NEEDS_INFO.
 */
async function triage(deps: AgentDeps, job: Job, msg: Message | null): Promise<StepResult> {
  const ctx = await loadJobContext(deps.db, job);
  const policy = await loadWorkflowPolicy(deps.db, job.organizationId);
  const out = await deps.llm.structured({
    ctx: llmCtx(job, job.state === 'NEEDS_INFO' ? 'retriage' : 'triage'),
    system: TRIAGE_SYSTEM,
    user: await renderJobContext(deps.db, ctx),
    schema: triageOutput,
    effort: 'medium',
  });
  let decision = decideTriage(out);
  // Inspection / monitor notes are the PM's, not the tenant's — unclear notes go back to the PM.
  if (decision.action === 'clarify' && job.source !== 'tenant_message') {
    decision = {
      action: 'escalate',
      reasons: [...decision.reasons, 'finding notes need more detail'],
      recommendation: `Add detail to the finding: ${out.missingInfo.join('; ') || 'what and where the issue is'}.`,
    };
  }
  if (decision.action === 'clarify' && job.clarifyRounds >= policy.clarify.maxRounds) {
    decision = {
      action: 'escalate',
      reasons: [
        ...decision.reasons,
        `still unclear after ${job.clarifyRounds} clarifying round(s)`,
      ],
      recommendation: `Call the tenant; still missing: ${out.missingInfo.join('; ') || 'details of the issue'}.`,
    };
  }
  const patch = {
    title: out.title.slice(0, 120),
    summary: out.summary,
    urgency: out.urgency,
    trade: out.trade,
    triageConfidence: Math.min(1, Math.max(0, out.confidence)),
    ...(out.askForMedia && out.mediaToCapture
      ? { mediaRequest: out.mediaToCapture.slice(0, 300) }
      : {}),
  };
  const agent = { type: 'agent' as const };

  await deps.db.transaction(async (tx) => {
    if (msg) await markProcessed(tx, msg);
    const tc = toolCtx(tx, job, 'Triage', deps.now(), msg ? `:m${msg.id}` : '');
    await writeAudit(tx, {
      organizationId: job.organizationId,
      jobId: job.id,
      actorType: 'agent',
      action: 'agent.triage',
      reason: decision.action === 'proceed' ? 'Triage passed policy' : decision.reasons.join('; '),
      output: { triage: out, decision },
      outcome: 'ok',
    });
    const base = { organizationId: job.organizationId, jobId: job.id, actor: agent };

    if (decision.action === 'escalate') {
      await patchJob(tx, { ...base, reason: 'Record triage before escalation', patch });
      await escalate(tc, {
        reason: decision.reasons.join('; '),
        summary: out.summary,
        // Say exactly what happened: the tenant is only messaged when that is safe (see below).
        whatHasBeenDone: [
          job.clarifyRounds > 0
            ? `Triaged and asked ${String(job.clarifyRounds)} clarifying question round(s).`
            : job.source === 'tenant_message'
              ? 'Triaged the request.'
              : 'Triaged the finding notes.',
          ctx.tenant && !out.flags.promptInjection && job.source === 'tenant_message'
            ? 'The tenant was acknowledged.'
            : 'Nothing was sent to the tenant.',
        ].join(' '),
        recommendation: decision.recommendation,
      });
    } else {
      await transitionJob(tx, {
        ...base,
        to: 'TRIAGED',
        reason: `Triaged as ${out.urgency} ${out.trade} (confidence ${patch.triageConfidence.toFixed(2)})`,
        patch,
      });
      if (decision.action === 'clarify') {
        await transitionJob(tx, {
          ...base,
          to: 'NEEDS_INFO',
          reason: `Asking tenant: ${out.missingInfo.join('; ') || 'more detail'}`,
          patch: { clarifyRounds: job.clarifyRounds + 1 },
        });
      }
    }
    const tenantReported = job.source === 'tenant_message';
    if (
      ctx.tenant &&
      !out.flags.promptInjection &&
      (tenantReported || decision.action !== 'escalate')
    ) {
      must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: out.tenantReply }));
    }
  });
  return decision.action === 'proceed' ? 'continue' : 'wait';
}
