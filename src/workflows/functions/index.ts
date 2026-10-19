import { arrearsAdvance, arrearsSweep, arrearsSweepNow, inboundRoute } from './arrears';
import { followUpHandler, followUpSweeper } from './follow-ups';
import { jobAdvance } from './job-advance';
import { mediaRetention } from './media-retention';
import { opsAnalysisNow, opsAnalystWeekly } from './ops-analyst';
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
  arrearsAdvance,
  arrearsSweep,
  arrearsSweepNow,
  inboundRoute,
  opsAnalystWeekly,
  opsAnalysisNow,
];
