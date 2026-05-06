CREATE TABLE "admin_2fa" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"totp_secret_enc" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"recovery_codes_enc" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint,
	"telegram_username" text,
	"google_email" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_assets" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "users_google_email_unique" UNIQUE("google_email")
);
--> statement-breakpoint
CREATE TABLE "mex_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mex_email" text NOT NULL,
	"api_key_enc" "bytea" NOT NULL,
	"api_secret_enc" "bytea" NOT NULL,
	"ip_whitelisted" text DEFAULT 'no' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_balance_sync" timestamp with time zone,
	"balance_cache" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mex_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "destination_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"asset" text NOT NULL,
	"network" text NOT NULL,
	"address" text NOT NULL,
	"memo" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_asset" text,
	"from_network" text,
	"to_asset" text NOT NULL,
	"to_network" text NOT NULL,
	"destination_wallet_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_commissions" (
	"asset" text PRIMARY KEY NOT NULL,
	"percent" numeric(6, 5) DEFAULT '0' NOT NULL,
	"fixed_amount" numeric(20, 8) DEFAULT '0' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_sweep_wallet" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"asset" text DEFAULT 'USDT' NOT NULL,
	"network" text DEFAULT 'TRC20' NOT NULL,
	"address" text NOT NULL,
	"memo" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_sweep_wallet_singleton" CHECK ("platform_sweep_wallet"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "user_commissions" (
	"user_id" uuid NOT NULL,
	"asset" text DEFAULT '*' NOT NULL,
	"percent" numeric(6, 5) DEFAULT '0' NOT NULL,
	"fixed_amount" numeric(20, 8) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "user_commissions_user_id_asset_pk" PRIMARY KEY("user_id","asset")
);
--> statement-breakpoint
CREATE TABLE "bounce_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deposit_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"withdraw_order_id" text NOT NULL,
	"conversion_order_id" text,
	"conversion_symbol" text,
	"destination_wallet_id" uuid,
	"user_amount_gross" numeric(20, 8),
	"user_amount_after_conv" numeric(20, 8),
	"user_commission_amount" numeric(20, 8),
	"platform_commission_amount" numeric(20, 8),
	"network_fee_estimated" numeric(20, 8),
	"user_amount_net" numeric(20, 8),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"on_hold_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounce_jobs_deposit_id_unique" UNIQUE("deposit_id"),
	CONSTRAINT "bounce_jobs_withdraw_order_id_unique" UNIQUE("withdraw_order_id")
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mex_account_id" uuid NOT NULL,
	"asset" text NOT NULL,
	"network" text NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"mex_tx_id" text NOT NULL,
	"on_chain_tx" text,
	"status" text DEFAULT 'detected' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sweep_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"total_swept" numeric(20, 8),
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"mex_account_id" uuid,
	"type" text NOT NULL,
	"bounce_job_id" uuid,
	"sweep_run_id" uuid,
	"asset" text NOT NULL,
	"network" text NOT NULL,
	"address" text NOT NULL,
	"memo" text,
	"amount" numeric(20, 8) NOT NULL,
	"withdraw_order_id" text NOT NULL,
	"mex_withdraw_id" text,
	"on_chain_tx" text,
	"fee" numeric(20, 8),
	"status" text DEFAULT 'pending' NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_withdraw_order_id_unique" UNIQUE("withdraw_order_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"payload" jsonb,
	"ip_address" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mex_api_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_params" jsonb,
	"response_status" integer,
	"response_body" jsonb,
	"response_ms" integer,
	"error" text,
	"withdraw_order_id" text
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"user_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"failed_at_step" text,
	"failed_reason" text,
	"summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "telegram_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid,
	"user_id" uuid,
	"chat_id" text,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"raw_payload" jsonb,
	"sent_ok" boolean,
	"error" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"step" text NOT NULL,
	"message" text NOT NULL,
	"payload_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"locked_by" text NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_2fa" ADD CONSTRAINT "admin_2fa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mex_accounts" ADD CONSTRAINT "mex_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination_wallets" ADD CONSTRAINT "destination_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_destination_wallet_id_destination_wallets_id_fk" FOREIGN KEY ("destination_wallet_id") REFERENCES "public"."destination_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_commissions" ADD CONSTRAINT "platform_commissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_commissions" ADD CONSTRAINT "user_commissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_commissions" ADD CONSTRAINT "user_commissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounce_jobs" ADD CONSTRAINT "bounce_jobs_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounce_jobs" ADD CONSTRAINT "bounce_jobs_destination_wallet_id_destination_wallets_id_fk" FOREIGN KEY ("destination_wallet_id") REFERENCES "public"."destination_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_mex_account_id_mex_accounts_id_fk" FOREIGN KEY ("mex_account_id") REFERENCES "public"."mex_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_mex_account_id_mex_accounts_id_fk" FOREIGN KEY ("mex_account_id") REFERENCES "public"."mex_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_bounce_job_id_bounce_jobs_id_fk" FOREIGN KEY ("bounce_job_id") REFERENCES "public"."bounce_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_sweep_run_id_sweep_runs_id_fk" FOREIGN KEY ("sweep_run_id") REFERENCES "public"."sweep_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_token_idx" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invitations_user_idx" ON "invitations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_deleted_at_idx" ON "users" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "mex_accounts_status_idx" ON "mex_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "destination_wallets_user_idx" ON "destination_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "destination_wallets_default_uq" ON "destination_wallets" USING btree ("user_id","asset","network") WHERE "destination_wallets"."is_default" = true AND "destination_wallets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "routing_rules_user_idx" ON "routing_rules" USING btree ("user_id","priority");--> statement-breakpoint
CREATE INDEX "bounce_jobs_state_idx" ON "bounce_jobs" USING btree ("state","locked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_mex_tx_unique" ON "deposits" USING btree ("mex_account_id","mex_tx_id");--> statement-breakpoint
CREATE INDEX "deposits_user_idx" ON "deposits" USING btree ("user_id","detected_at");--> statement-breakpoint
CREATE INDEX "deposits_status_idx" ON "deposits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "withdrawals_type_idx" ON "withdrawals" USING btree ("type");--> statement-breakpoint
CREATE INDEX "withdrawals_bounce_job_idx" ON "withdrawals" USING btree ("bounce_job_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","ts");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","ts");--> statement-breakpoint
CREATE INDEX "mex_api_calls_op_idx" ON "mex_api_calls" USING btree ("operation_id","ts");--> statement-breakpoint
CREATE INDEX "mex_api_calls_woid_idx" ON "mex_api_calls" USING btree ("withdraw_order_id");--> statement-breakpoint
CREATE INDEX "mex_api_calls_ts_idx" ON "mex_api_calls" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "operations_user_idx" ON "operations" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "operations_type_status_idx" ON "operations" USING btree ("type","status","started_at");--> statement-breakpoint
CREATE INDEX "operations_started_at_idx" ON "operations" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "telegram_messages_pending_idx" ON "telegram_messages" USING btree ("direction","sent_ok","ts");--> statement-breakpoint
CREATE INDEX "trace_events_op_idx" ON "trace_events" USING btree ("operation_id","ts");