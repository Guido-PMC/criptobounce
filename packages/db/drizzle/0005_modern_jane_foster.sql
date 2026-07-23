CREATE TABLE "manual_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mex_account_id" uuid NOT NULL,
	"created_by_admin_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_by_admin_id" uuid,
	"from_asset" text NOT NULL,
	"from_network" text NOT NULL,
	"to_asset" text NOT NULL,
	"to_network" text NOT NULL,
	"nominal_amount" numeric(20, 8) NOT NULL,
	"verifier_digits" text NOT NULL,
	"expected_deposit_amount" numeric(20, 8) NOT NULL,
	"estimated_output" numeric(20, 8),
	"received_amount" numeric(20, 8),
	"amount_to_execute" numeric(20, 8),
	"converted_amount_gross" numeric(20, 8),
	"executed_output" numeric(20, 8),
	"surplus_amount" numeric(20, 8),
	"surplus_asset" text,
	"average_fill_price" numeric(30, 12),
	"confirmation_quote" numeric(30, 12),
	"confirmation_quote_at" timestamp with time zone,
	"max_slippage_bps" integer DEFAULT 200 NOT NULL,
	"mex_trading_commission" numeric(20, 8),
	"mex_commission_asset" text,
	"user_commission_amount" numeric(20, 8),
	"platform_commission_amount" numeric(20, 8),
	"payout_network_fee" numeric(20, 8),
	"refund_network_fee" numeric(20, 8),
	"payout_wallet_id" uuid NOT NULL,
	"payout_address" text NOT NULL,
	"payout_memo" text,
	"refund_wallet_id" uuid,
	"refund_address" text,
	"refund_memo" text,
	"spot_symbol" text,
	"spot_side" text,
	"conversion_order_id" text,
	"state" text DEFAULT 'awaiting_deposit' NOT NULL,
	"resume_state" text,
	"reject_reason" text,
	"last_error" text,
	"internal_notes" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"matched_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_ops_nominal_positive" CHECK ("manual_operations"."nominal_amount" > 0),
	CONSTRAINT "manual_ops_expected_positive" CHECK ("manual_operations"."expected_deposit_amount" > 0),
	CONSTRAINT "manual_ops_verifier_check" CHECK ("manual_operations"."verifier_digits" ~ '^[0-9]{2}$'),
	CONSTRAINT "manual_ops_side_check" CHECK ("manual_operations"."spot_side" IS NULL OR "manual_operations"."spot_side" IN ('BUY', 'SELL')),
	CONSTRAINT "manual_ops_state_check" CHECK ("manual_operations"."state" IN (
        'awaiting_deposit', 'awaiting_deposit_confirmation',
        'pending_user_confirm', 'pending_admin_confirm', 'pending_candidate_resolution',
        'converting', 'awaiting_conversion', 'withdrawing', 'awaiting_withdrawal',
        'refunding', 'awaiting_refund', 'on_hold',
        'done', 'failed', 'expired', 'cancelled'
      ))
);
--> statement-breakpoint
CREATE TABLE "manual_operation_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manual_operation_id" uuid NOT NULL,
	"deposit_id" uuid NOT NULL,
	"match_type" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"source_amount_raw" text NOT NULL,
	"source_inserted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_operation_deposits_deposit_id_unique" UNIQUE("deposit_id"),
	CONSTRAINT "manual_op_deposits_match_type_check" CHECK ("manual_operation_deposits"."match_type" IN ('exact', 'mismatch')),
	CONSTRAINT "manual_op_deposits_status_check" CHECK ("manual_operation_deposits"."status" IN (
        'candidate', 'selected', 'rejected', 'refunded', 'released_to_bounce'
      ))
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "amount_raw" text;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "manual_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD CONSTRAINT "manual_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD CONSTRAINT "manual_operations_mex_account_id_mex_accounts_id_fk" FOREIGN KEY ("mex_account_id") REFERENCES "public"."mex_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD CONSTRAINT "manual_operations_created_by_admin_id_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD CONSTRAINT "manual_operations_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD CONSTRAINT "manual_operations_confirmed_by_admin_id_users_id_fk" FOREIGN KEY ("confirmed_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD CONSTRAINT "manual_operations_payout_wallet_id_destination_wallets_id_fk" FOREIGN KEY ("payout_wallet_id") REFERENCES "public"."destination_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_operations" ADD CONSTRAINT "manual_operations_refund_wallet_id_destination_wallets_id_fk" FOREIGN KEY ("refund_wallet_id") REFERENCES "public"."destination_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_operation_deposits" ADD CONSTRAINT "manual_operation_deposits_manual_operation_id_manual_operations_id_fk" FOREIGN KEY ("manual_operation_id") REFERENCES "public"."manual_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_operation_deposits" ADD CONSTRAINT "manual_operation_deposits_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_ops_one_active_per_user" ON "manual_operations" USING btree ("user_id") WHERE "manual_operations"."state" IN (
  'awaiting_deposit',
  'awaiting_deposit_confirmation',
  'pending_user_confirm',
  'pending_admin_confirm',
  'pending_candidate_resolution',
  'converting',
  'awaiting_conversion',
  'withdrawing',
  'awaiting_withdrawal',
  'refunding',
  'awaiting_refund',
  'on_hold'
);--> statement-breakpoint
CREATE UNIQUE INDEX "manual_ops_one_active_per_mex_account" ON "manual_operations" USING btree ("mex_account_id") WHERE "manual_operations"."state" IN (
  'awaiting_deposit',
  'awaiting_deposit_confirmation',
  'pending_user_confirm',
  'pending_admin_confirm',
  'pending_candidate_resolution',
  'converting',
  'awaiting_conversion',
  'withdrawing',
  'awaiting_withdrawal',
  'refunding',
  'awaiting_refund',
  'on_hold'
);--> statement-breakpoint
CREATE INDEX "manual_ops_awaiting_match_idx" ON "manual_operations" USING btree ("user_id","from_asset","from_network","expected_deposit_amount") WHERE "manual_operations"."state" = 'awaiting_deposit';--> statement-breakpoint
CREATE INDEX "manual_ops_worker_idx" ON "manual_operations" USING btree ("state","locked_at","created_at");--> statement-breakpoint
CREATE INDEX "manual_ops_user_idx" ON "manual_operations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_op_one_selected_deposit" ON "manual_operation_deposits" USING btree ("manual_operation_id") WHERE "manual_operation_deposits"."status" = 'selected';--> statement-breakpoint
CREATE INDEX "manual_op_deposit_candidates_idx" ON "manual_operation_deposits" USING btree ("manual_operation_id","status","created_at");--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_manual_operation_id_manual_operations_id_fk" FOREIGN KEY ("manual_operation_id") REFERENCES "public"."manual_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawals_manual_operation_idx" ON "withdrawals" USING btree ("manual_operation_id","type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_messages_dedupe_uq" ON "telegram_messages" USING btree ("dedupe_key");