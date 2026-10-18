CREATE TYPE "public"."approval_kind" AS ENUM('quote', 'variation');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('matched', 'needs_review');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"source_message_id" uuid,
	"source_media_id" uuid,
	"reference" text,
	"amount_cents" integer NOT NULL,
	"approved_cents" integer,
	"difference_cents" integer,
	"status" "invoice_status" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amount_nonneg" CHECK ("invoices"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "kind" "approval_kind" DEFAULT 'quote' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "previous_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_org_job_idx" ON "invoices" USING btree ("organization_id","job_id");--> statement-breakpoint
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON invoices
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
