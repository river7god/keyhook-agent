/**
 * Job states from spec §5. Single source of truth for both the Postgres enum and the
 * TypeScript type. Allowed transitions live in ./state-machine.ts.
 */
export const JOB_STATES = [
  'RECEIVED',
  'TRIAGED',
  'NEEDS_INFO',
  'AWAITING_QUOTE',
  'AWAITING_APPROVAL',
  'SCHEDULING',
  'SCHEDULED',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
  'CLOSED',
  'ESCALATED',
  'CANCELLED',
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_STATES = ['CLOSED', 'CANCELLED'] as const satisfies readonly JobState[];
