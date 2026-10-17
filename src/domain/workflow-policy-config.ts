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
  quietHours: { startHour: 20, endHour: 8 },
};
