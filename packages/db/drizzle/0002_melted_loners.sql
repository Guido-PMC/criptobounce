CREATE TABLE "mex_deposit_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mex_account_id" uuid NOT NULL,
	"coin" text NOT NULL,
	"network" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"address" text,
	"memo" text,
	"last_error" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mex_deposit_addresses" ADD CONSTRAINT "mex_deposit_addresses_mex_account_id_mex_accounts_id_fk" FOREIGN KEY ("mex_account_id") REFERENCES "public"."mex_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mex_deposit_addresses_pair_idx" ON "mex_deposit_addresses" USING btree ("mex_account_id","coin","network");--> statement-breakpoint
CREATE INDEX "mex_deposit_addresses_account_idx" ON "mex_deposit_addresses" USING btree ("mex_account_id");