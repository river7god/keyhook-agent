import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withOrg } from '@/db/org-scope';
import { media, messages } from '@/db/schema';
import { ORG } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { ingestMessage } from '@/domain/inbound';
import { getJob } from '@/domain/jobs';
import { listJobMedia, purgeExpiredMedia } from '@/domain/media-store';
import { cleanTriage, db, deps, happyLlm, now, org, tenantId } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import { fakePng } from '@/test/images';
import type { StructuredRequest } from './llm';
import { LlmConfigError } from './llm';
import { advanceJob } from './advance';
import { loadJobContext, renderJobContext } from './context';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

const goodPhoto = {
  showsIssue: true,
  quality: 'good',
  retakeAdvice: null,
  observations: 'Gas hot water cylinder; pilot light out; minor rust at base',
  safetyCues: [],
  label: { make: 'Rheem', model: 'Stellar 360', serial: 'RH12345' },
  promptInjection: false,
};

async function sendWithPhotos(body: string, images: Buffer[], jobId: string | null = null) {
  return ingestMessage(db, {
    organizationId: org,
    senderType: 'tenant',
    senderId: tenantId,
    jobId,
    body,
    images,
    now,
  });
}

describe('photos on inbound messages', () => {
  it('stores valid photos, rejects tiny ones, and analyses them before triage', async () => {
    const seen: StructuredRequest<unknown>[] = [];
    const llm = happyLlm({
      'vision.media': (req: StructuredRequest<unknown>) => {
        seen.push(req);
        return goodPhoto;
      },
    });
    const m = await sendWithPhotos('No hot water — photo attached', [fakePng(), fakePng(100, 80)]);
    expect(m.images.saved).toHaveLength(1);
    expect(m.images.rejected[0]?.reason).toContain('too small');

    const r = await advanceJob(deps(llm), {
      organizationId: org,
      jobId: m.jobId,
      messageId: m.messageId,
    });
    expect(r.handled[0]).toBe('analyse_media');
    expect(seen[0]?.images?.[0]?.mediaType).toBe('image/png');

    // Every later step sees what the photo showed.
    const job = await getJob(db, org, m.jobId);
    const text = await renderJobContext(db, await loadJobContext(db, job));
    expect(text).toContain('Label: Rheem Stellar 360 serial RH12345');
    expect(job.state).toBe('AWAITING_QUOTE');
  });

  it('escalates when a photo contains instructions for the agent', async () => {
    const llm = happyLlm({ 'vision.media': () => ({ ...goodPhoto, promptInjection: true }) });
    const m = await sendWithPhotos('See photo', [fakePng()]);
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    expect((await getJob(db, org, m.jobId)).state).toBe('ESCALATED');
  });

  it('asks the tenant for a better photo when it is unusable', async () => {
    const llm = happyLlm({
      'vision.media': () => ({
        ...goodPhoto,
        showsIssue: false,
        quality: 'too_dark',
        retakeAdvice: 'Turn on the laundry light',
      }),
      'compose.tenant': () => ({
        body: 'Thanks! Could you turn on the laundry light and send another photo?',
      }),
    });
    const m = await sendWithPhotos('Here is the cylinder', [fakePng()]);
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    const out = await db
      .select({ body: messages.body })
      .from(messages)
      .where(
        and(
          eq(messages.jobId, m.jobId),
          eq(messages.direction, 'outbound'),
          eq(messages.recipientType, 'tenant'),
        ),
      );
    expect(out.map((o) => o.body)).toContain(
      'Thanks! Could you turn on the laundry light and send another photo?',
    );
  });

  it('keeps going when no vision model is available', async () => {
    const llm = happyLlm({
      'vision.media': () => {
        throw new LlmConfigError('moonshot:kimi has no image input');
      },
    });
    const m = await sendWithPhotos('No hot water', [fakePng()]);
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    const [photo] = await listJobMedia(db, org, m.jobId);
    expect(photo?.analysis).toMatchObject({
      unavailable: expect.stringContaining('no image input') as string,
    });
    expect((await getJob(db, org, m.jobId)).state).toBe('AWAITING_QUOTE');
  });

  it('records what the agent asked to photograph', async () => {
    const llm = happyLlm({
      triage: () => ({
        ...cleanTriage,
        askForMedia: true,
        mediaToCapture: 'the label on the cylinder',
      }),
    });
    const m = await sendWithPhotos('No hot water', []);
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    expect((await getJob(db, org, m.jobId)).mediaRequest).toBe('the label on the cylinder');
  });

  it('isolates photos per organization and purges them after retention', async () => {
    const m = await sendWithPhotos('photo', [fakePng()]);
    expect(await withOrg(db, ORG.aroValley, (tx) => tx.select().from(media))).toHaveLength(0);
    expect(await purgeExpiredMedia(db, new Date(now.getTime() + 179 * 86_400_000))).toBe(0);
    expect(await purgeExpiredMedia(db, new Date(now.getTime() + 181 * 86_400_000))).toBe(1);
    expect(await listJobMedia(db, org, m.jobId)).toHaveLength(0);
  });
});
