CREATE TABLE "financial_account_locks" (
	"mex_account_id" uuid PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manual_operations" ADD COLUMN "terminal_state" text;--> statement-breakpoint
ALTER TABLE "financial_account_locks" ADD CONSTRAINT "financial_account_locks_mex_account_id_mex_accounts_id_fk" FOREIGN KEY ("mex_account_id") REFERENCES "public"."mex_accounts"("id") ON DELETE cascade ON UPDATE no action;