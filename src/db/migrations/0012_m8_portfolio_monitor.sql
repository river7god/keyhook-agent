CREATE TYPE "public"."monitor_finding_kind" AS ENUM('repeated_fault');--> statement-breakpoint
CREATE TYPE "public"."monitor_finding_status" AS ENUM('open', 'dismissed', 'opened');--> statement-breakpoint
CREATE TABLE "monitor_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" "monitor_finding_kind" NOT NULL,
	"trade" "trade" NOT NULL,
	"evidence_job_ids" uuid[] NOT NULL,
	"summary" text NOT NULL,
	"recommendation" text NOT NULL,
	"status" "monitor_finding_status" DEFAULT 'open' NOT NULL,
	"opened_job_id" uuid,
	"decided_by" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"detected_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitor_findings" ADD CONSTRAINT "monitor_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_findings" ADD CONSTRAINT "monitor_findings_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitor_findings_org_status_idx" ON "monitor_findings" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_findings_one_open_uq" ON "monitor_findings" USING btree ("organization_id","property_id","kind","trade") WHERE "monitor_findings"."status" = 'open';--> statement-breakpoint
ALTER TABLE monitor_findings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON monitor_findings
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
