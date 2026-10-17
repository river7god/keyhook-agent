import { cron } from 'inngest';
import { getDb } from '@/db/client';
import { purgeExpiredMedia } from '@/domain/media-store';
import { inngest } from '../client';

/** Daily: delete photos past their 180-day retention (spec §12 R1). */
export const mediaRetention = inngest.createFunction(
  { id: 'media-retention', triggers: [cron('TZ=Pacific/Auckland 30 3 * * *')] },
  async ({ step }) => step.run('purge', () => purgeExpiredMedia(getDb(), new Date())),
);
