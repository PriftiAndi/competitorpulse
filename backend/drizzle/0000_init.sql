CREATE TYPE "public"."snapshot_status" AS ENUM('ok', 'partial', 'not_found', 'error');--> statement-breakpoint
CREATE TYPE "public"."summary_status" AS ENUM('ok', 'pending', 'failed', 'unusable', 'cap_reached', 'disabled', 'not_needed', 'no_previous', 'poll_failed');--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_status" "snapshot_status",
	"last_changed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"status" "snapshot_status" NOT NULL,
	"title" text,
	"tagline" text,
	"price" text,
	"price_amount" numeric(12, 2),
	"price_currency" text,
	"price_period" text,
	"description" text,
	"missing_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"changed" boolean DEFAULT false NOT NULL,
	"changes" jsonb,
	"summary" text,
	"summary_status" "summary_status" NOT NULL,
	"summary_source" text,
	"summary_error" text,
	"summary_attempts" integer DEFAULT 0 NOT NULL,
	"summary_next_attempt_at" timestamp with time zone,
	"summary_model" text
);
--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitors_next_poll_idx" ON "competitors" USING btree ("next_poll_at") WHERE removed_at is null;--> statement-breakpoint
CREATE INDEX "snapshots_competitor_fetched_idx" ON "snapshots" USING btree ("competitor_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "snapshots_fetched_idx" ON "snapshots" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "snapshots_summary_pending_idx" ON "snapshots" USING btree ("summary_next_attempt_at") WHERE summary_status = 'pending';