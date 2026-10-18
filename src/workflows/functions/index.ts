import { followUpHandler, followUpSweeper } from './follow-ups';
import { jobAdvance } from './job-advance';
import { mediaRetention } from './media-retention';
import { ping } from './ping';
import { portfolioMonitor } from './portfolio-monitor';

/** Register every Inngest function here; served from /api/inngest. */
export const functions = [
  ping,
  jobAdvance,
  followUpSweeper,
  followUpHandler,
  mediaRetention,
  portfolioMonitor,
];
