import type { DbOrTx } from '@/db/client';
import { findOpenCase, getCase } from './arrears';
import { DomainError } from './errors';
import { createJobFromTenantMessage, getJob } from './jobs';
import { saveMessageImages, type Rejected } from './media-store';
import { recordInbound } from './messages';

/**
 * Entry point for every inbound tenant/tradie message (simulator today, SMS/email adapters later).
 * A tenant message without jobId opens a new job; otherwise the sender must belong to the job.
 */
export async function ingestMessage(
  db: DbOrTx,
  args: {
    organizationId: string;
    senderType: 'tenant' | 'tradie';
    senderId: string;
    jobId?: string | null;
    body: string;
    /** Raw image files attached to the message (photos from the tenant or supplier). */
    images?: Buffer[];
    now?: Date;
  },
): Promise<{
  jobId: string;
  messageId: string;
  newJob: boolean;
  images: { saved: string[]; rejected: Rejected[] };
}> {
  return db.transaction(async (tx) => {
    let jobId = args.jobId ?? null;
    let newJob = false;
    if (!jobId) {
      if (args.senderType !== 'tenant') {
        throw new DomainError('VALIDATION', 'Only tenants can open a new job by message');
      }
      const job = await createJobFromTenantMessage(tx, {
        organizationId: args.organizationId,
        tenantId: args.senderId,
        body: args.body,
      });
      jobId = job.id;
      newJob = true;
    } else {
      const job = await getJob(tx, args.organizationId, jobId);
      const belongs =
        args.senderType === 'tenant'
          ? job.reportedByTenantId === args.senderId
          : job.assignedTradieId === args.senderId;
      if (!belongs)
        throw new DomainError('VALIDATION', `This ${args.senderType} is not on this job`);
    }
    const msg = await recordInbound(tx, {
      organizationId: args.organizationId,
      jobId,
      senderType: args.senderType,
      senderId: args.senderId,
      body: args.body,
    });
    const images = args.images?.length
      ? await saveMessageImages(tx, {
          organizationId: args.organizationId,
          jobId,
          messageId: msg.id,
          files: args.images,
          now: args.now ?? new Date(),
        })
      : { saved: [], rejected: [] };
    return { jobId, messageId: msg.id, newJob, images };
  });
}

export type Received =
  | {
      kind: 'job';
      jobId: string;
      messageId: string;
      images: { saved: string[]; rejected: Rejected[] };
    }
  | { kind: 'arrears'; arrearsCaseId: string; messageId: string }
  | { kind: 'unrouted'; messageId: string };

/**
 * Inbound entry point that also knows about arrears (spec §12 R8):
 * - a reply inside an arrears conversation goes to that case (the sender must be its tenant);
 * - a new tenant message from someone with an open arrears case is stored unrouted, for the inbox
 *   router to place (rent → the case, anything else → a new job);
 * - everything else (and anything with photos) is a maintenance message, as before.
 */
export async function receiveMessage(
  db: DbOrTx,
  args: Parameters<typeof ingestMessage>[1] & { arrearsCaseId?: string | null },
): Promise<Received> {
  if (args.arrearsCaseId) {
    if (args.senderType !== 'tenant') {
      throw new DomainError('VALIDATION', 'Only the tenant can reply on an arrears case');
    }
    if (args.images?.length) {
      throw new DomainError('VALIDATION', 'Photos can only be attached to maintenance requests');
    }
    const caseId = args.arrearsCaseId;
    const c = await getCase(db, args.organizationId, caseId);
    if (c.tenantId !== args.senderId) {
      throw new DomainError('VALIDATION', 'This tenant is not on this arrears case');
    }
    const msg = await recordInbound(db, {
      organizationId: args.organizationId,
      jobId: null,
      arrearsCaseId: caseId,
      senderType: 'tenant',
      senderId: args.senderId,
      body: args.body,
    });
    return { kind: 'arrears', arrearsCaseId: caseId, messageId: msg.id };
  }
  if (
    args.senderType === 'tenant' &&
    !args.jobId &&
    !args.images?.length &&
    (await findOpenCase(db, args.organizationId, { tenantId: args.senderId }))
  ) {
    const msg = await recordInbound(db, {
      organizationId: args.organizationId,
      jobId: null,
      senderType: 'tenant',
      senderId: args.senderId,
      body: args.body,
    });
    return { kind: 'unrouted', messageId: msg.id };
  }
  const r = await ingestMessage(db, args);
  return { kind: 'job', jobId: r.jobId, messageId: r.messageId, images: r.images };
}
