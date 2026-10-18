import { pgEnum } from 'drizzle-orm/pg-core';
import { JOB_STATES } from '@/workflows/job-states';

export const jobStateEnum = pgEnum('job_state', JOB_STATES);
export const urgencyEnum = pgEnum('urgency', ['emergency', 'urgent', 'routine']);
/** `other` = could not classify; triage routes these to a PM. `handyman` covers general repairs. */
export const tradeEnum = pgEnum('trade', [
  'plumbing',
  'electrical',
  'heating',
  'handyman',
  'locksmith',
  'other',
]);
export const jobSourceEnum = pgEnum('job_source', [
  'tenant_message',
  'pm_created',
  'agent_detected',
  'inspection',
]);
export const actorTypeEnum = pgEnum('actor_type', [
  'tenant',
  'tradie',
  'pm',
  'owner',
  'agent',
  'system',
]);
export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);
export const messageChannelEnum = pgEnum('message_channel', ['simulator', 'sms', 'email']);
export const messageStatusEnum = pgEnum('message_status', ['received', 'queued', 'sent', 'failed']);
export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
]);
export const followUpStatusEnum = pgEnum('follow_up_status', [
  'scheduled',
  'sent',
  'satisfied',
  'cancelled',
]);
/** Which wait a follow-up belongs to; each maps to exactly one job state set (domain/follow-ups). */
export const followUpKindEnum = pgEnum('follow_up_kind', [
  'info_chase',
  'quote_chase',
  'approval_chase',
  'slot_chase',
  'visit_check',
  'confirmation_chase',
]);
/** What a PM says the agent got wrong (agent_feedback). */
export const feedbackKindEnum = pgEnum('feedback_kind', [
  'urgency',
  'trade',
  'should_have_escalated',
  'should_not_have_escalated',
  'other',
]);
export const approvalKindEnum = pgEnum('approval_kind', ['quote', 'variation']);
export const monitorFindingKindEnum = pgEnum('monitor_finding_kind', ['repeated_fault']);
export const monitorFindingStatusEnum = pgEnum('monitor_finding_status', [
  'open',
  'dismissed',
  'opened',
]);
export const invoiceStatusEnum = pgEnum('invoice_status', ['matched', 'needs_review']);
export const feedbackSourceEnum = pgEnum('feedback_source', ['pm_flag', 'hand_back_override']);
export const auditOutcomeEnum = pgEnum('audit_outcome', ['ok', 'rejected', 'error']);

export type Urgency = (typeof urgencyEnum.enumValues)[number];
export type Trade = (typeof tradeEnum.enumValues)[number];
export type JobSource = (typeof jobSourceEnum.enumValues)[number];
export type ActorType = (typeof actorTypeEnum.enumValues)[number];
export type ApprovalStatus = (typeof approvalStatusEnum.enumValues)[number];
export type AuditOutcome = (typeof auditOutcomeEnum.enumValues)[number];
export type FollowUpKind = (typeof followUpKindEnum.enumValues)[number];
export type FeedbackKind = (typeof feedbackKindEnum.enumValues)[number];
