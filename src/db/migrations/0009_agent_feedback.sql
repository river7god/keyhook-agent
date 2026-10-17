CREATE TYPE "public"."feedback_kind" AS ENUM('urgency', 'trade', 'should_have_escalated', 'should_not_have_escalated', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_source" AS ENUM('pm_flag', 'hand_back_override');--> statement-breakpoint
CREATE TABLE "agent_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"property_manager_id" uuid,
	"source" "feedback_source" NOT NULL,
	"kind" "feedback_kind" NOT NULL,
	"expected" jsonb NOT NULL,
	"agent_saw" jsonb NOT NULL,
	"note" text,
	"harvested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_pm_fk" FOREIGN KEY ("organization_id","property_manager_id") REFERENCES "public"."property_managers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_feedback_org_created_idx" ON "agent_feedback" USING btree ("organization_id","created_at");--> statement-breakpoint
-- Row-level security, same as every organization-scoped table (migration 0007).
ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON agent_feedback
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
