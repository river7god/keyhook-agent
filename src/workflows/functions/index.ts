import { followUpHandler, followUpSweeper } from './follow-ups';
import { jobAdvance } from './job-advance';
import { ping } from './ping';

/** Register every Inngest function here; served from /api/inngest. */
export const functions = [ping, jobAdvance, followUpSweeper, followUpHandler];
