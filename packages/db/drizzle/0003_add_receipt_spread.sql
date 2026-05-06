ALTER TABLE "users" ADD COLUMN "receipt_spread_percent" numeric(6, 5) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bounce_jobs" ADD COLUMN "receipt_spread_percent" numeric(6, 5);