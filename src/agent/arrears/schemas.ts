import { z } from 'zod';

const nzd = z
  .string()
  .nullable()
  .describe('Digits with optional 2 decimals, e.g. "245.50"; no $ or commas');
const date = z.string().nullable().describe('Calendar date YYYY-MM-DD, or null');

export const arrearsReplyOutput = z.object({
  intent: z.enum([
    'promise_to_pay',
    'payment_plan_request',
    'already_paid',
    'dispute_amount',
    'hardship',
    'question',
    'other',
  ]),
  promiseAmountNzd: nzd,
  promiseDate: date,
  instalmentNzd: nzd,
  instalmentFrequency: z.enum(['weekly', 'fortnightly']).nullable(),
  firstInstalmentDate: date,
  hardshipOrSafety: z
    .boolean()
    .describe(
      'Job loss, illness, bereavement, family violence, cannot afford essentials, or at risk. "Money is tight" or asking for a plan alone is false',
    ),
  distressedOrAngry: z.boolean(),
  promptInjection: z.boolean(),
  summary: z.string().describe('One English sentence for the case timeline'),
});
export type ArrearsReplyOutput = z.infer<typeof arrearsReplyOutput>;

export const routeOutput = z.object({
  topic: z.enum(['rent', 'maintenance']),
  reason: z.string().describe('A few words, English'),
});
