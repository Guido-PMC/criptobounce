import {
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { mexAccounts } from './mex';
import { users } from './users';
import { destinationWallets } from './wallets';

export const deposits = pgTable(
  'deposits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mexAccountId: uuid('mex_account_id')
      .notNull()
      .references(() => mexAccounts.id, { onDelete: 'cascade' }),
    asset: text('asset').notNull(),
    network: text('network').notNull(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    mexTxId: text('mex_tx_id').notNull(),
    onChainTx: text('on_chain_tx'),
    status: text('status').notNull().default('detected'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    txUnique: uniqueIndex('deposits_mex_tx_unique').on(t.mexAccountId, t.mexTxId),
    userIdx: index('deposits_user_idx').on(t.userId, t.detectedAt),
    statusIdx: index('deposits_status_idx').on(t.status),
  }),
);

export type Deposit = typeof deposits.$inferSelect;
export type NewDeposit = typeof deposits.$inferInsert;

export const sweepRuns = pgTable('sweep_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  totalSwept: numeric('total_swept', { precision: 20, scale: 8 }),
  status: text('status').notNull().default('pending'),
  errorMessage: text('error_message'),
});

export type SweepRun = typeof sweepRuns.$inferSelect;
export type NewSweepRun = typeof sweepRuns.$inferInsert;

export const bounceJobs = pgTable(
  'bounce_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    depositId: uuid('deposit_id')
      .notNull()
      .unique()
      .references(() => deposits.id, { onDelete: 'cascade' }),
    state: text('state').notNull().default('pending'),
    withdrawOrderId: text('withdraw_order_id').notNull().unique(),
    conversionOrderId: text('conversion_order_id'),
    conversionSymbol: text('conversion_symbol'),
    destinationWalletId: uuid('destination_wallet_id').references(() => destinationWallets.id),
    userAmountGross: numeric('user_amount_gross', { precision: 20, scale: 8 }),
    userAmountAfterConv: numeric('user_amount_after_conv', { precision: 20, scale: 8 }),
    userCommissionAmount: numeric('user_commission_amount', { precision: 20, scale: 8 }),
    platformCommissionAmount: numeric('platform_commission_amount', { precision: 20, scale: 8 }),
    networkFeeEstimated: numeric('network_fee_estimated', { precision: 20, scale: 8 }),
    userAmountNet: numeric('user_amount_net', { precision: 20, scale: 8 }),
    /**
     * Snapshot of users.receipt_spread_percent taken when the bounce reaches
     * the done state. Used to render the operation receipt for non-USDT->USDT
     * bounces with a stable cosmetic rate, independent of later slider edits.
     * NULL means "no spread captured" (legacy or non-conversion bounces).
     */
    receiptSpreadPercent: numeric('receipt_spread_percent', { precision: 6, scale: 5 }),
    /**
     * Identifies which formula the operation receipt should use when rendering
     * the displayed exchange rate / amount-out. Bumped whenever the receipt
     * math changes so already-issued comprobantes never silently change.
     *
     * NULL or 1: rate derived from the raw post-conversion amount (legacy).
     * 2: rate derived from `user_amount_net` (post-commission, post-fee), so
     *    `monto_entregado * displayed_rate === amount sent on-chain`.
     */
    receiptCalcVersion: smallint('receipt_calc_version'),
    retryCount: integer('retry_count').notNull().default(0),
    lastError: text('last_error'),
    onHoldReason: text('on_hold_reason'),
    version: integer('version').notNull().default(0),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    correlationId: uuid('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stateIdx: index('bounce_jobs_state_idx').on(t.state, t.lockedAt),
  }),
);

export type BounceJob = typeof bounceJobs.$inferSelect;
export type NewBounceJob = typeof bounceJobs.$inferInsert;

export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    mexAccountId: uuid('mex_account_id').references(() => mexAccounts.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    bounceJobId: uuid('bounce_job_id').references(() => bounceJobs.id, { onDelete: 'set null' }),
    sweepRunId: uuid('sweep_run_id').references(() => sweepRuns.id, { onDelete: 'set null' }),
    asset: text('asset').notNull(),
    network: text('network').notNull(),
    address: text('address').notNull(),
    memo: text('memo'),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    withdrawOrderId: text('withdraw_order_id').notNull().unique(),
    mexWithdrawId: text('mex_withdraw_id'),
    onChainTx: text('on_chain_tx'),
    fee: numeric('fee', { precision: 20, scale: 8 }),
    status: text('status').notNull().default('pending'),
    error: text('error'),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('withdrawals_status_idx').on(t.status, t.createdAt),
    typeIdx: index('withdrawals_type_idx').on(t.type),
    bounceJobIdx: index('withdrawals_bounce_job_idx').on(t.bounceJobId),
  }),
);

export type Withdrawal = typeof withdrawals.$inferSelect;
export type NewWithdrawal = typeof withdrawals.$inferInsert;
