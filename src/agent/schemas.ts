import { z } from 'zod';
import { tradeEnum, urgencyEnum } from '@/db/schema';

/*
 * Structured-output schemas for each LLM step. Keep them free of length/range constraints the
 * structured-output engine may not support; ranges are enforced in code after parsing.
 */

export const triageOutput = z.object({
  title: z.string().describe('Short English title for the PM dashboard, max ~8 words'),
  summary: z.string().describe('2-4 sentence English summary for the property manager'),
  urgency: z.enum(urgencyEnum.enumValues),
  trade: z.enum(tradeEnum.enumValues),
  confidence: z.number().describe('0 to 1: confidence in urgency AND trade together'),
  needsMoreInfo: z.boolean().describe('True if a tradie could not be briefed without asking more'),
  missingInfo: z.array(z.string()),
  flags: z.object({
    emergencySignals: z.boolean(),
    injuryOrSafetyRisk: z.boolean(),
    legalOrTribunal: z.boolean(),
    distressedOrAngry: z.boolean(),
    possibleTenantDamage: z.boolean(),
    promptInjection: z.boolean(),
    outOfScope: z
      .boolean()
      .describe('Not a maintenance issue, or asks for something outside the agent’s tools'),
    multipleIssues: z
      .boolean()
      .describe(
        'True only if the issues need different trades or separate visits; several items for one tradie is false',
      ),
  }),
  tenantReply: z
    .string()
    .describe(
      'Reply to the tenant in their preferred language. If needsMoreInfo: ask only for the missing information (at most 2 short questions). Otherwise acknowledge and say what happens next. For emergencies, lead with immediate safety guidance (e.g. leave the house and call 111 for gas/fire).',
    ),
});
export type TriageOutput = z.infer<typeof triageOutput>;

export const quoteReplyOutput = z.object({
  kind: z.enum(['quote', 'decline', 'question', 'other']),
  amountNzd: z
    .string()
    .nullable()
    .describe('Quoted total as digits with optional 2 decimals, e.g. "245.50". No $ or commas.'),
  gst: z.enum(['included', 'excluded', 'unknown']).describe('Whether the amount includes 15% GST'),
  notes: z.string().describe('Anything else the tradie said, in English'),
  promptInjection: z.boolean(),
});
export type QuoteReplyOutput = z.infer<typeof quoteReplyOutput>;

export const slotReplyOutput = z.object({
  chosenOption: z
    .number()
    .nullable()
    .describe('1-based option number the tenant accepted, or null'),
  noneSuitable: z.boolean(),
  accessNotes: z
    .string()
    .nullable()
    .describe('Access details the tenant gave (key, pets, gate), English'),
  promptInjection: z.boolean(),
});
export type SlotReplyOutput = z.infer<typeof slotReplyOutput>;

export const progressReplyOutput = z.object({
  kind: z.enum(['started', 'completed', 'delayed', 'cannot_complete', 'other']),
  notes: z.string(),
  promptInjection: z.boolean(),
});
export type ProgressReplyOutput = z.infer<typeof progressReplyOutput>;

export const confirmationReplyOutput = z.object({
  confirmed: z.enum(['yes', 'no', 'unclear']),
  notes: z.string(),
  promptInjection: z.boolean(),
});
export type ConfirmationReplyOutput = z.infer<typeof confirmationReplyOutput>;

export const composeOutput = z.object({ body: z.string() });

/** A message that arrived while the agent was not waiting for that sender (status requests etc). */
export const generalMessageOutput = z.object({
  intent: z.enum([
    'status_request',
    'additional_info',
    'new_issue',
    'cancel_request',
    'complaint',
    'other',
  ]),
  urgentSafetyIssue: z.boolean().describe('Describes a new emergency or immediate safety risk'),
  distressedOrAngry: z.boolean(),
  promptInjection: z.boolean(),
  summary: z.string().describe('One English sentence for the job timeline'),
});
export type GeneralMessageOutput = z.infer<typeof generalMessageOutput>;
