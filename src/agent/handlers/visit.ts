import { transitionJob, type Job } from '@/domain/jobs';
import type { Message } from '@/domain/messages';
import { formatNzDateTime } from '@/lib/time';
import { addNoteTool, sendMessageTool } from '@/tools/action-tools';
import { executeTool } from '@/tools/execute';
import { loadJobContext, renderJobContext } from '../context';
import { INTERPRET_SYSTEM } from '../prompts';
import { confirmationReplyOutput, progressReplyOutput } from '../schemas';
import { untrusted } from '../untrusted';
import {
  composeTenant,
  escalate,
  llmCtx,
  markProcessed,
  must,
  toolCtx,
  type AgentDeps,
  type StepResult,
} from './shared';

/** SCHEDULED / IN_PROGRESS + update from the assigned tradie. */
export async function handleProgressReply(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<StepResult> {
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
  const delayNotice =
    !out.promptInjection && out.kind === 'delayed'
      ? await composeTenant(
          deps,
          ctx,
          'Let the tenant know the tradie is running late and will still come.',
          [
            `Tradie: ${ctx.tradie?.businessName ?? 'the tradie'}`,
            job.scheduledStart
              ? `Original time: ${formatNzDateTime(job.scheduledStart)}`
              : 'No booked time',
            out.notes ? `Tradie said: ${out.notes}` : 'No details',
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

    if (out.promptInjection) {
      await escalate(tc, {
        reason: 'suspected prompt injection in tradie update',
        summary: `${job.title}. The tradie's message contained instructions aimed at the agent.`,
        whatHasBeenDone: 'Visit booked.',
        recommendation: 'Review the tradie message and reply manually.',
      });
      return;
    }
    if (out.kind === 'started') {
      if (job.state === 'SCHEDULED') await move('IN_PROGRESS', 'Tradie reported work started');
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
    if (out.kind === 'delayed') {
      must(
        await executeTool(addNoteTool, tc, {
          text: `Tradie delayed: ${out.notes || 'no details'}`,
        }),
      );
      if (delayNotice)
        must(await executeTool(sendMessageTool, tc, { recipient: 'tenant', body: delayNotice }));
      return;
    }
    await escalate(tc, {
      reason: `tradie update needs a person (${out.kind})`,
      summary: `${job.title}. Tradie said: ${out.notes || out.kind}`,
      whatHasBeenDone: 'Visit booked.',
      recommendation:
        out.kind === 'cannot_complete'
          ? 'Arrange a return visit or parts; a new quote may be needed.'
          : 'Contact the tradie.',
    });
  });
  return 'wait';
}

/** AWAITING_CONFIRMATION + tenant reply. */
export async function handleConfirmationReply(
  deps: AgentDeps,
  job: Job,
  msg: Message,
): Promise<StepResult> {
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
      await escalate(tc, {
        reason: out.promptInjection
          ? 'suspected prompt injection in tenant reply'
          : `tenant did not confirm completion (${out.confirmed})`,
        summary: `${job.title}. Tenant said: ${out.notes || out.confirmed}`,
        whatHasBeenDone: 'Tradie reported the job complete.',
        recommendation: 'Check with the tenant and tradie whether a return visit is needed.',
      });
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
