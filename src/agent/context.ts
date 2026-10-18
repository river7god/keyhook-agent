import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { messages, properties, tenants, tradies } from '@/db/schema';
import type { Job } from '@/domain/jobs';
import { listJobMedia } from '@/domain/media-store';
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

/** Jobs not reported by a tenant start from notes, not a message (spec §12 R4, R7). */
const SOURCE_LABEL: Partial<Record<Job['source'], string>> = {
  inspection: 'property inspection (not reported by the tenant)',
  agent_detected:
    'Portfolio Monitor finding opened by the property manager (not reported by the tenant)',
  pm_created: 'the property manager',
};

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

  const photos = await listJobMedia(db, job.organizationId, job.id);
  const photoLines = photos.map((p, i) => {
    const a = p.analysis;
    if (!a) return `Photo ${i + 1}: not analysed yet`;
    if ('unavailable' in a) return `Photo ${i + 1}: received, could not be analysed`;
    const label =
      a.label && (a.label.make ?? a.label.model ?? a.label.serial)
        ? ` Label: ${[a.label.make, a.label.model, a.label.serial && `serial ${a.label.serial}`].filter(Boolean).join(' ')}.`
        : '';
    const cues = a.safetyCues.length ? ` Safety cues: ${a.safetyCues.join('; ')}.` : '';
    return `Photo ${i + 1} (${a.quality}${a.showsIssue ? '' : ', does not show the issue'}): ${a.observations}${label}${cues}`;
  });

  return [
    `Job: ${job.title}`,
    `State: ${job.state}`,
    SOURCE_LABEL[job.source] ? `Raised by: ${SOURCE_LABEL[job.source]}` : null,
    SOURCE_LABEL[job.source] && job.description
      ? `Finding notes:\n${untrusted(job.description, { from: job.source })}`
      : null,
    `Property: ${property.address}, ${property.suburb}`,
    property.accessNotes ? `PM access notes: ${property.accessNotes}` : null,
    job.urgency ? `Urgency: ${job.urgency}` : null,
    job.trade ? `Trade: ${job.trade}` : null,
    tenant
      ? `Tenant: ${tenant.fullName} (profile language: ${tenant.preferredLanguage} — reply in the language of their latest message)`
      : null,
    tradie ? `Assigned tradie: ${tradie.businessName} (${tradie.contactName})` : null,
    job.mediaRequest ? `Photo requested from tenant: ${job.mediaRequest}` : null,
    photoLines.length ? `Photos (agent's own analysis):\n${photoLines.join('\n')}` : null,
    '',
    'Conversation so far:',
    conversation || '(none)',
  ]
    .filter((l) => l !== null)
    .join('\n');
}
