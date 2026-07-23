ALTER TABLE "manual_operations" ALTER COLUMN "payout_wallet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD COLUMN "payout_mex_coin" text;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD COLUMN "payout_mex_network" text;