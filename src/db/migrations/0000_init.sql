CREATE TYPE "public"."actor_type" AS ENUM('tenant', 'tradie', 'pm', 'owner', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('ok', 'rejected', 'error');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('scheduled', 'sent', 'satisfied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_source" AS ENUM('tenant_message', 'pm_created', 'agent_detected', 'inspection');--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('RECEIVED', 'TRIAGED', 'NEEDS_INFO', 'AWAITING_QUOTE', 'AWAITING_APPROVAL', 'SCHEDULING', 'SCHEDULED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'CLOSED', 'ESCALATED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('simulator', 'sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."trade" AS ENUM('plumbing', 'electrical', 'heating', 'handyman', 'locksmith', 'other');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('emergency', 'urgent', 'routine');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Pacific/Auckland' NOT NULL,
	"default_pm_auto_approve_limit_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_default_limit_nonneg" CHECK ("organizations"."default_pm_auto_approve_limit_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "property_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"auto_approve_limit_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_managers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "property_managers_org_email_uq" UNIQUE("organization_id","email"),
	CONSTRAINT "property_managers_limit_nonneg" CHECK ("property_managers"."auto_approve_limit_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"approval_limit_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "owners_approval_limit_nonneg" CHECK ("owners"."approval_limit_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"property_manager_id" uuid NOT NULL,
	"address_line1" text NOT NULL,
	"suburb" text NOT NULL,
	"city" text DEFAULT 'Wellington' NOT NULL,
	"postcode" text NOT NULL,
	"access_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenancies_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tenancies_dates_ordered" CHECK ("tenancies"."end_date" IS NULL OR "tenancies"."end_date" >= "tenancies"."start_date")
);
--> statement-breakpoint
CREATE TABLE "tenancy_tenants" (
	"organization_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"is_primary_contact" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tenancy_tenants_tenancy_id_tenant_id_pk" PRIMARY KEY("tenancy_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"trades" "trade"[] NOT NULL,
	"suburbs" text[] NOT NULL,
	"rating" numeric(2, 1),
	"emergency_callouts" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tradies_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tradies_rating_range" CHECK ("tradies"."rating" BETWEEN 0 AND 5),
	CONSTRAINT "tradies_has_trade" CHECK (cardinality("tradies"."trades") > 0),
	CONSTRAINT "tradies_has_suburb" CHECK (cardinality("tradies"."suburbs") > 0)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"tenancy_id" uuid,
	"reported_by_tenant_id" uuid,
	"source" "job_source" NOT NULL,
	"created_by_actor_type" "actor_type" NOT NULL,
	"created_by_actor_id" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"state" "job_state" DEFAULT 'RECEIVED' NOT NULL,
	"state_before_escalation" "job_state",
	"version" integer DEFAULT 0 NOT NULL,
	"urgency" "urgency",
	"trade" "trade",
	"triage_confidence" real,
	"estimate_cents" integer,
	"assigned_tradie_id" uuid,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "jobs_confidence_range" CHECK ("jobs"."triage_confidence" BETWEEN 0 AND 1),
	CONSTRAINT "jobs_estimate_nonneg" CHECK ("jobs"."estimate_cents" >= 0),
	CONSTRAINT "jobs_schedule_window_valid" CHECK (("jobs"."scheduled_start" IS NULL) = ("jobs"."scheduled_end" IS NULL) AND ("jobs"."scheduled_end" IS NULL OR "jobs"."scheduled_end" > "jobs"."scheduled_start")),
	CONSTRAINT "jobs_escalation_consistent" CHECK (("jobs"."state" = 'ESCALATED') = ("jobs"."state_before_escalation" IS NOT NULL) AND "jobs"."state_before_escalation" IS DISTINCT FROM 'ESCALATED'),
	CONSTRAINT "jobs_tenant_source_has_reporter" CHECK ("jobs"."source" <> 'tenant_message' OR "jobs"."reported_by_tenant_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid,
	"direction" "message_direction" NOT NULL,
	"channel" "message_channel" DEFAULT 'simulator' NOT NULL,
	"sender_type" "actor_type" NOT NULL,
	"sender_id" uuid,
	"recipient_type" "actor_type" NOT NULL,
	"recipient_id" uuid,
	"body" text NOT NULL,
	"status" "message_status" NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_org_idempotency_uq" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "messages_outbound_has_idempotency_key" CHECK ("messages"."direction" = 'inbound' OR "messages"."idempotency_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_org_idempotency_uq" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "approvals_amount_nonneg" CHECK ("approvals"."amount_cents" >= 0),
	CONSTRAINT "approvals_decision_recorded" CHECK ("approvals"."status" NOT IN ('approved', 'rejected') OR ("approvals"."decided_by" IS NOT NULL AND "approvals"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"job_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"reason" text,
	"input" jsonb,
	"output" jsonb,
	"outcome" "audit_outcome" NOT NULL,
	"idempotency_key" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"target_type" "actor_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "follow_up_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_ups_attempt_positive" CHECK ("follow_ups"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"tool" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_keys_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
ALTER TABLE "property_managers" ADD CONSTRAINT "property_managers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."owners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_pm_fk" FOREIGN KEY ("organization_id","property_manager_id") REFERENCES "public"."property_managers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy_tenants" ADD CONSTRAINT "tenancy_tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy_tenants" ADD CONSTRAINT "tenancy_tenants_tenancy_fk" FOREIGN KEY ("organization_id","tenancy_id") REFERENCES "public"."tenancies"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy_tenants" ADD CONSTRAINT "tenancy_tenants_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."tenants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradies" ADD CONSTRAINT "tradies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenancy_fk" FOREIGN KEY ("organization_id","tenancy_id") REFERENCES "public"."tenancies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_reporter_fk" FOREIGN KEY ("organization_id","reported_by_tenant_id") REFERENCES "public"."tenants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tradie_fk" FOREIGN KEY ("organization_id","assigned_tradie_id") REFERENCES "public"."tradies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "properties_org_suburb_idx" ON "properties" USING btree ("organization_id","suburb");--> statement-breakpoint
CREATE INDEX "tenancies_org_property_idx" ON "tenancies" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "tenancy_tenants_tenant_idx" ON "tenancy_tenants" USING btree ("organization_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenancy_tenants_one_primary_uq" ON "tenancy_tenants" USING btree ("tenancy_id") WHERE "tenancy_tenants"."is_primary_contact";--> statement-breakpoint
CREATE INDEX "tradies_trades_gin" ON "tradies" USING gin ("trades");--> statement-breakpoint
CREATE INDEX "tradies_suburbs_gin" ON "tradies" USING gin ("suburbs");--> statement-breakpoint
CREATE INDEX "jobs_org_state_idx" ON "jobs" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "jobs_org_property_created_idx" ON "jobs" USING btree ("organization_id","property_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_org_job_created_idx" ON "messages" USING btree ("organization_id","job_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_org_status_idx" ON "approvals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_pending_per_job_uq" ON "approvals" USING btree ("job_id") WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "audit_log_org_job_created_idx" ON "audit_log" USING btree ("organization_id","job_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "follow_ups_status_due_idx" ON "follow_ups" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "follow_ups_org_job_idx" ON "follow_ups" USING btree ("organization_id","job_id");