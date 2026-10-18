CREATE TYPE "public"."arrears_state" AS ENUM('OPEN', 'REMINDED', 'PROMISED', 'NOTICE_PENDING', 'NOTICE_SENT', 'ESCALATED', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('charge', 'payment');--> statement-breakpoint
CREATE TYPE "public"."rent_frequency" AS ENUM('weekly', 'fortnightly');--> statement-breakpoint
ALTER TYPE "public"."approval_kind" ADD VALUE 'arrears_notice';--> statement-breakpoint
CREATE TABLE "arrears_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"state" "arrears_state" DEFAULT 'OPEN' NOT NULL,
	"state_before_escalation" "arrears_state",
	"balance_cents" integer NOT NULL,
	"oldest_unpaid_date" date NOT NULL,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"promise_amount_cents" integer,
	"promise_date" date,
	"promise_made_on" date,
	"plan_instalment_cents" integer,
	"plan_frequency" "rent_frequency",
	"notice_sent_at" timestamp with time zone,
	"remedy_by_date" date,
	"escalation_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arrears_cases_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "arrears_cases_balance_nonneg" CHECK ("arrears_cases"."balance_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rent_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenancy_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"effective_date" date NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rent_ledger_amount_positive" CHECK ("rent_ledger"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "workflow_policy" SET DEFAULT '{"clarify":{"maxRounds":2,"reminderAfterHours":24,"escalateAfterHours":24},"quote":{"reminderAfterHours":{"emergency":1,"urgent":4,"routine":24},"maxReminders":2,"maxTradiesTried":3},"slot":{"reminderAfterHours":24,"escalateAfterHours":24,"maxOffers":2},"visit":{"checkAfterEndHours":4,"escalateAfterHours":24},"confirmation":{"reminderAfterHours":48,"escalateAfterHours":72},"approval":{"reminderAfterHours":24},"arrears":{"graceDays":2,"reminderEveryDays":3,"maxReminders":2,"promiseMaxDaysAhead":7,"planMaxWeeks":8,"noticeAtDays":10,"tribunalAtDays":21},"quietHours":{"startHour":20,"endHour":8}}'::jsonb;--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "job_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancies" ADD COLUMN "rent_cents" integer;--> statement-breakpoint
ALTER TABLE "tenancies" ADD COLUMN "rent_frequency" "rent_frequency";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "arrears_case_id" uuid;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "arrears_case_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "arrears_case_id" uuid;--> statement-breakpoint
ALTER TABLE "arrears_cases" ADD CONSTRAINT "arrears_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrears_cases" ADD CONSTRAINT "arrears_cases_tenancy_fk" FOREIGN KEY ("organization_id","tenancy_id") REFERENCES "public"."tenancies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrears_cases" ADD CONSTRAINT "arrears_cases_tenant_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "public"."tenants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_ledger" ADD CONSTRAINT "rent_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_ledger" ADD CONSTRAINT "rent_ledger_tenancy_fk" FOREIGN KEY ("organization_id","tenancy_id") REFERENCES "public"."tenancies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arrears_cases_one_open_uq" ON "arrears_cases" USING btree ("organization_id","tenancy_id") WHERE "arrears_cases"."state" NOT IN ('RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE INDEX "arrears_cases_org_state_idx" ON "arrears_cases" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "rent_ledger_org_tenancy_date_idx" ON "rent_ledger" USING btree ("organization_id","tenancy_id","effective_date");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_arrears_case_fk" FOREIGN KEY ("organization_id","arrears_case_id") REFERENCES "public"."arrears_cases"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_arrears_case_fk" FOREIGN KEY ("organization_id","arrears_case_id") REFERENCES "public"."arrears_cases"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_arrears_case_fk" FOREIGN KEY ("organization_id","arrears_case_id") REFERENCES "public"."arrears_cases"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_org_arrears_created_idx" ON "messages" USING btree ("organization_id","arrears_case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_pending_per_arrears_uq" ON "approvals" USING btree ("arrears_case_id") WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "audit_log_org_arrears_created_idx" ON "audit_log" USING btree ("organization_id","arrears_case_id","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_one_subject" CHECK (num_nonnulls("messages"."job_id", "messages"."arrears_case_id") <= 1);--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_one_subject" CHECK (num_nonnulls("approvals"."job_id", "approvals"."arrears_case_id") = 1);--> statement-breakpoint
ALTER TABLE arrears_cases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON arrears_cases
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE rent_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON rent_ledger
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
