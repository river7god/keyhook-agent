import { z } from 'zod';

/**
 * Per-organization timing and retry policy for follow-ups (decisions.md 2026-10-17, M2).
 * All values are product defaults agreed with the product owner and tunable per agency.
 */
const hours = z
  .number()
  .min(0.25)
  .max(24 * 14);

export const workflowPolicySchema = z.object({
  clarify: z.object({
    maxRounds: z.number().int().min(0).max(5),
    reminderAfterHours: hours,
    escalateAfterHours: hours,
  }),
  quote: z.object({
    reminderAfterHours: z.object({ emergency: hours, urgent: hours, routine: hours }),
    maxReminders: z.number().int().min(0).max(5),
    /** Including the first tradie. Reached → escalate. */
    maxTradiesTried: z.number().int().min(1).max(10),
  }),
  slot: z.object({
    reminderAfterHours: hours,
    escalateAfterHours: hours,
    maxOffers: z.number().int().min(1).max(5),
  }),
  visit: z.object({ checkAfterEndHours: hours, escalateAfterHours: hours }),
  confirmation: z.object({ reminderAfterHours: hours, escalateAfterHours: hours }),
  approval: z.object({ reminderAfterHours: hours }),
  /**
   * Arrears (spec §12 R8). Proposed defaults — confirm with the product owner. NZ law to verify
   * with Tenancy Services: a 14-day notice to remedy, and Tribunal termination when rent is
   * 21 days in arrears (RTA s55, s56).
   */
  arrears: z
    .object({
      /** A case opens when the oldest unpaid rent is more than this many days overdue. */
      graceDays: z.number().int().min(0).max(14),
      /** Days between friendly reminders, and how many before the notice stage. */
      reminderEveryDays: z.number().int().min(1).max(14),
      maxReminders: z.number().int().min(1).max(5),
      /** The agent may accept a promise to pay within this many days. */
      promiseMaxDaysAhead: z.number().int().min(1).max(28),
      /** The agent may agree a plan that clears the arrears within this many weeks. */
      planMaxWeeks: z.number().int().min(1).max(26),
      /** Draft a 14-day notice to remedy (PM approves) from this many days overdue. */
      noticeAtDays: z.number().int().min(1).max(60),
      /** Escalate to a PM (Tribunal is a person's decision) from this many days overdue. */
      tribunalAtDays: z.number().int().min(1).max(90),
    })
    .default({
      graceDays: 2,
      reminderEveryDays: 3,
      maxReminders: 2,
      promiseMaxDaysAhead: 7,
      planMaxWeeks: 8,
      noticeAtDays: 10,
      tribunalAtDays: 21,
    }),
  /** NZ local hours during which reminders are not sent; postponed to endHour. */
  quietHours: z.object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
  }),
});

export type WorkflowPolicy = z.infer<typeof workflowPolicySchema>;

export const DEFAULT_WORKFLOW_POLICY: WorkflowPolicy = {
  clarify: { maxRounds: 2, reminderAfterHours: 24, escalateAfterHours: 24 },
  quote: {
    reminderAfterHours: { emergency: 1, urgent: 4, routine: 24 },
    maxReminders: 2,
    maxTradiesTried: 3,
  },
  slot: { reminderAfterHours: 24, escalateAfterHours: 24, maxOffers: 2 },
  visit: { checkAfterEndHours: 4, escalateAfterHours: 24 },
  confirmation: { reminderAfterHours: 48, escalateAfterHours: 72 },
  approval: { reminderAfterHours: 24 },
  arrears: {
    graceDays: 2,
    reminderEveryDays: 3,
    maxReminders: 2,
    promiseMaxDaysAhead: 7,
    planMaxWeeks: 8,
    noticeAtDays: 10,
    tribunalAtDays: 21,
  },
  quietHours: { startHour: 20, endHour: 8 },
};
