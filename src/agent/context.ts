import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { messages, properties, tenants, tradies } from '@/db/schema';
import type { Job } from '@/domain/jobs';
import { formatNzDateTime } from '@/lib/time';
import { untrusted } from './untrusted';

export interface JobContext {
  job: Job;
  property: {
    address: string;
    suburb: string;
    accessNotes: string | null;
    propertyManagerId: string;
  };
  tenant: { id: string; fullName: string; preferredLanguage: string } | null;
  tradie: { id: string; businessName: string; contactName: string } | null;
}

export async function loadJobContext(db: DbOrTx, job: Job): Promise<JobContext> {
  const org = job.organizationId;
  const [property] = await db
    .select({
      address: properties.addressLine1,
      suburb: properties.suburb,
      accessNotes: properties.accessNotes,
      propertyManagerId: properties.propertyManagerId,
    })
    .from(properties)
    .where(and(eq(properties.organizationId, org), eq(properties.id, job.propertyId)));
  if (!property) throw new Error(`Property missing for job ${job.id}`);

  const [tenant] = job.reportedByTenantId
    ? await db
        .select({
          id: tenants.id,
          fullName: tenants.fullName,
          preferredLanguage: tenants.preferredLanguage,
        })
        .from(tenants)
        .where(and(eq(tenants.organizationId, org), eq(tenants.id, job.reportedByTenantId)))
    : [];
  const [tradie] = job.assignedTradieId
    ? await db
        .select({
          id: tradies.id,
          businessName: tradies.businessName,
          contactName: tradies.contactName,
        })
        .from(tradies)
        .where(and(eq(tradies.organizationId, org), eq(tradies.id, job.assignedTradieId)))
    : [];

  return { job, property, tenant: tenant ?? null, tradie: tradie ?? null };
}

/** Job facts + recent conversation for the user turn. Inbound text is wrapped as untrusted. */
export async function renderJobContext(
  db: DbOrTx,
  ctx: JobContext,
  opts: { history?: number } = {},
) {
  const { job, property, tenant, tradie } = ctx;
  const recent = await db
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, job.organizationId), eq(messages.jobId, job.id)))
    .orderBy(desc(messages.createdAt))
    .limit(opts.history ?? 12);

  const conversation = recent
    .reverse()
    .map((m) => {
      const when = formatNzDateTime(m.createdAt);
      return m.direction === 'inbound'
        ? `[${when}] from ${m.senderType}:\n${untrusted(m.body, { from: m.senderType })}`
        : `[${when}] agent → ${m.recipientType}: ${m.body}`;
    })
    .join('\n\n');

  return [
    `Job: ${job.title}`,
    `State: ${job.state}`,
    `Property: ${property.address}, ${property.suburb}`,
    property.accessNotes ? `PM access notes: ${property.accessNotes}` : null,
    job.urgency ? `Urgency: ${job.urgency}` : null,
    job.trade ? `Trade: ${job.trade}` : null,
    tenant ? `Tenant: ${tenant.fullName} (preferred language: ${tenant.preferredLanguage})` : null,
    tradie ? `Assigned tradie: ${tradie.businessName} (${tradie.contactName})` : null,
    '',
    'Conversation so far:',
    conversation || '(none)',
  ]
    .filter((l) => l !== null)
    .join('\n');
}
