/** Arrears case states (spec §12 R8). Terminal: RESOLVED (paid up), CLOSED (PM closed it). */
export const ARREARS_STATES = [
  'OPEN',
  'REMINDED',
  'PROMISED',
  'NOTICE_PENDING',
  'NOTICE_SENT',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;
export type ArrearsState = (typeof ARREARS_STATES)[number];
export const ARREARS_TERMINAL: readonly ArrearsState[] = ['RESOLVED', 'CLOSED'];
