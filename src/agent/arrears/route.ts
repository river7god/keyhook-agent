import { and, eq, isNull } from 'drizzle-orm';
import { messages } from '@/db/schema';
import { findOpenCase } from '@/domain/arrears';
import { writeAudit } from '@/domain/audit';
import { DomainError } from '@/domain/errors';
import { createJobFromTenantMessage } from '@/domain/jobs';
import type { AgentDeps } from '../handlers/shared';
import { LlmConfigError, LlmOutputError, LlmRefusalError } from '../llm';
import { untrusted } from '../untrusted';
import { ROUTE_SYSTEM } from './prompts';
import { routeOutput } from './schemas';

export type Routed = { kind: 'arrears'; caseId: string } | { kind: 'job'; jobId: string };

/**
 * Inbox router (roadmap "Inbox router", first slice): a tenant message that arrived without a
 * conversation goes to their open arrears case or opens a maintenance job. Only tenants with an
 * open case reach the model; everyone else opens a job as before. If the model is unavailable,
 * the message becomes a job (triage then escalates anything it can't place).
 */
export async function routeInbound(
  deps: AgentDeps,
  args: { organizationId: string; messageId: string },
): Promise<Routed> {
  const [msg] = await deps.db
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, args.organizationId), eq(messages.id, args.messageId)));
  if (!msg || msg.direction !== 'inbound' || msg.senderType !== 'tenant' || !msg.senderId) {
    throw new DomainError('VALIDATION', 'Only inbound tenant messages are routed');
  }
  if (msg.jobId) return { kind: 'job', jobId: msg.jobId };
  if (msg.arrearsCaseId) return { kind: 'arrears', caseId: msg.arrearsCaseId };
  const tenantId = msg.senderId;

  const open = await findOpenCase(deps.db, args.organizationId, { tenantId });
  let topic: 'rent' | 'maintenance' = 'maintenance';
  let why = 'tenant has no open arrears case';
  if (open) {
    try {
      const out = await deps.llm.structured({
        ctx: { organizationId: args.organizationId, jobId: null, step: 'route.inbound' },
        system: ROUTE_SYSTEM,
        user: untrusted(msg.body, { from: 'tenant' }),
        schema: routeOutput,
        effort: 'low',
      });
      topic = out.topic;
      why = out.reason;
    } catch (err) {
      if (!(
        err instanceof LlmConfigError ||
        err instanceof LlmOutputError ||
        err instanceof LlmRefusalError
      ))
        throw err;
      why = `router unavailable (${err.name}); defaulted to maintenance`;
    }
  }

  return deps.db.transaction(async (tx) => {
    const unrouted = and(
      eq(messages.organizationId, args.organizationId),
      eq(messages.id, msg.id),
      isNull(messages.jobId),
      isNull(messages.arrearsCaseId),
    );
    let routed: Routed;
    if (topic === 'rent' && open) {
      await tx.update(messages).set({ arrearsCaseId: open.id }).where(unrouted);
      routed = { kind: 'arrears', caseId: open.id };
    } else {
      const job = await createJobFromTenantMessage(tx, {
        organizationId: args.organizationId,
        tenantId,
        body: msg.body,
      });
      await tx.update(messages).set({ jobId: job.id }).where(unrouted);
      routed = { kind: 'job', jobId: job.id };
    }
    await writeAudit(tx, {
      organizationId: args.organizationId,
      jobId: routed.kind === 'job' ? routed.jobId : null,
      arrearsCaseId: routed.kind === 'arrears' ? routed.caseId : null,
      actorType: 'agent',
      action: 'inbound.routed',
      reason: why,
      input: { messageId: msg.id },
      output: routed,
      outcome: 'ok',
    });
    return routed;
  });
}
