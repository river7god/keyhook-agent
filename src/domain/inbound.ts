import type { DbOrTx } from '@/db/client';
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
