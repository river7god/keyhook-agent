import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { invoices, properties } from '@/db/schema';
import { formatNzd } from '@/lib/money';
import { writeAudit } from './audit';
import type { Job } from './jobs';
import { queueOutbound } from './messages';

/** spec §12 R3 (confirmed): an invoice over the approved amount by ≤ 5 % or ≤ NZ$50 matches. */
export const INVOICE_TOLERANCE = { percent: 5, cents: 5_000 } as const;

export type InvoiceCheck =
  | { status: 'matched'; differenceCents: number; reason: string }
  | { status: 'needs_review'; differenceCents: number | null; reason: string };

export function checkInvoice(amountCents: number, approvedCents: number | null): InvoiceCheck {
  if (approvedCents === null) {
    return {
      status: 'needs_review',
      differenceCents: null,
      reason: 'No approved amount on the job to compare with',
    };
  }
  const difference = amountCents - approvedCents;
  const tolerance = Math.max(
    Math.round((approvedCents * INVOICE_TOLERANCE.percent) / 100),
    INVOICE_TOLERANCE.cents,
  );
  if (difference <= tolerance) {
    return {
      status: 'matched',
      differenceCents: difference,
      reason:
        difference <= 0
          ? `Invoice ${formatNzd(amountCents)} is within the approved ${formatNzd(approvedCents)}`
          : `Invoice is ${formatNzd(difference)} over the approved ${formatNzd(approvedCents)} — within tolerance`,
    };
  }
  return {
    status: 'needs_review',
    differenceCents: difference,
    reason: `Invoice ${formatNzd(amountCents)} is ${formatNzd(difference)} over the approved ${formatNzd(approvedCents)} (tolerance ${formatNzd(tolerance)})`,
  };
}

/** Record a supplier invoice, compare with the approved amount, and ask the PM to review if needed. */
export async function recordInvoice(
  tx: DbOrTx,
  args: {
    job: Job;
    amountCents: number;
    reference: string | null;
    sourceMessageId?: string | null;
    sourceMediaId?: string | null;
    idempotencyKey: string;
  },
) {
  const { job } = args;
  const result = checkInvoice(args.amountCents, job.estimateCents);
  const [row] = await tx
    .insert(invoices)
    .values({
      organizationId: job.organizationId,
      jobId: job.id,
      sourceMessageId: args.sourceMessageId ?? null,
      sourceMediaId: args.sourceMediaId ?? null,
      reference: args.reference,
      amountCents: args.amountCents,
      approvedCents: job.estimateCents,
      differenceCents: result.differenceCents,
      status: result.status,
      reason: result.reason,
    })
    .returning();
  if (!row) throw new Error('invoice insert failed');
  await writeAudit(tx, {
    organizationId: job.organizationId,
    jobId: job.id,
    actorType: 'agent',
    action: 'invoice.checked',
    reason: result.reason,
    input: {
      amountCents: args.amountCents,
      approvedCents: job.estimateCents,
      reference: args.reference,
    },
    output: { invoiceId: row.id, status: result.status },
    outcome: 'ok',
  });
  if (result.status === 'needs_review') {
    const [p] = await tx
      .select({ pmId: properties.propertyManagerId, address: properties.addressLine1 })
      .from(properties)
      .where(
        and(eq(properties.organizationId, job.organizationId), eq(properties.id, job.propertyId)),
      );
    if (p) {
      await queueOutbound(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        recipientType: 'pm',
        recipientId: p.pmId,
        body: `Invoice to review: ${job.title} (${p.address})${args.reference ? `, ref ${args.reference}` : ''}\n${result.reason}`,
        idempotencyKey: `${args.idempotencyKey}:pm`,
      });
    }
  }
  return row;
}

export function listJobInvoices(db: DbOrTx, organizationId: string, jobId: string) {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.jobId, jobId)));
}
