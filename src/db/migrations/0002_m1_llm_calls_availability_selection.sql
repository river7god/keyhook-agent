CREATE TABLE "llm_calls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "llm_calls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"job_id" uuid,
	"step" text NOT NULL,
	"requested_model" text NOT NULL,
	"served_model" text,
	"stop_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd_micros" integer,
	"latency_ms" integer NOT NULL,
	"request_id" text,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tradie_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tradie_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"booked_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tradie_availability_window_valid" CHECK ("tradie_availability"."ends_at" > "tradie_availability"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tradie_selection" jsonb DEFAULT '{"strategy":"rules","weights":{"rating":1,"availability":1,"familiarity":0.5,"workload":0.5},"availabilityHorizonHours":168,"shortlistSize":3}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradie_availability" ADD CONSTRAINT "tradie_availability_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradie_availability" ADD CONSTRAINT "tradie_availability_tradie_fk" FOREIGN KEY ("organization_id","tradie_id") REFERENCES "public"."tradies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradie_availability" ADD CONSTRAINT "tradie_availability_job_fk" FOREIGN KEY ("organization_id","booked_job_id") REFERENCES "public"."jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_calls_org_job_idx" ON "llm_calls" USING btree ("organization_id","job_id","created_at");--> statement-breakpoint
CREATE INDEX "tradie_availability_tradie_starts_idx" ON "tradie_availability" USING btree ("organization_id","tradie_id","starts_at");