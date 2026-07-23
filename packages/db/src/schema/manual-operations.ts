import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { mexAccounts } from './mex';
import { users } from './users';
import { destinationWallets } from './wallets';

const ACTIVE_STATES = sql`(
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
)`;

export const manualOperations = pgTable(
  'manual_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mexAccountId: uuid('mex_account_id')
      .notNull()
      .references(() => mexAccounts.id, { onDelete: 'restrict' }),
    createdByAdminId: uuid('created_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    confirmedByAdminId: uuid('confirmed_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    fromAsset: text('from_asset').notNull(),
    fromNetwork: text('from_network').notNull(),
    toAsset: text('to_asset').notNull(),
    toNetwork: text('to_network').notNull(),

    nominalAmount: numeric('nominal_amount', { precision: 20, scale: 8 }).notNull(),
    verifierDigits: text('verifier_digits').notNull(),
    expectedDepositAmount: numeric('expected_deposit_amount', {
      precision: 20,
      scale: 8,
    }).notNull(),
    estimatedOutput: numeric('estimated_output', { precision: 20, scale: 8 }),
    receivedAmount: numeric('received_amount', { precision: 20, scale: 8 }),
    amountToExecute: numeric('amount_to_execute', { precision: 20, scale: 8 }),
    convertedAmountGross: numeric('converted_amount_gross', { precision: 20, scale: 8 }),
    executedOutput: numeric('executed_output', { precision: 20, scale: 8 }),
    surplusAmount: numeric('surplus_amount', { precision: 20, scale: 8 }),
    surplusAsset: text('surplus_asset'),
    averageFillPrice: numeric('average_fill_price', { precision: 30, scale: 12 }),
    confirmationQuote: numeric('confirmation_quote', { precision: 30, scale: 12 }),
    confirmationQuoteAt: timestamp('confirmation_quote_at', { withTimezone: true }),
    maxSlippageBps: integer('max_slippage_bps').notNull().default(200),
    mexTradingCommission: numeric('mex_trading_commission', { precision: 20, scale: 8 }),
    mexCommissionAsset: text('mex_commission_asset'),
    userCommissionAmount: numeric('user_commission_amount', { precision: 20, scale: 8 }),
    platformCommissionAmount: numeric('platform_commission_amount', {
      precision: 20,
      scale: 8,
    }),
    payoutPrecisionDust: numeric('payout_precision_dust', { precision: 20, scale: 8 }),
    payoutNetworkFee: numeric('payout_network_fee', { precision: 20, scale: 8 }),
    refundNetworkFee: numeric('refund_network_fee', { precision: 20, scale: 8 }),

    payoutWalletId: uuid('payout_wallet_id').references(() => destinationWallets.id, {
      onDelete: 'restrict',
    }),
    payoutAddress: text('payout_address').notNull(),
    payoutMemo: text('payout_memo'),
    payoutMexCoin: text('payout_mex_coin'),
    payoutMexNetwork: text('payout_mex_network'),
    refundWalletId: uuid('refund_wallet_id').references(() => destinationWallets.id, {
      onDelete: 'restrict',
    }),
    refundAddress: text('refund_address'),
    refundMemo: text('refund_memo'),

    spotSymbol: text('spot_symbol'),
    spotSide: text('spot_side'),
    conversionOrderId: text('conversion_order_id'),
    state: text('state').notNull().default('awaiting_deposit'),
    resumeState: text('resume_state'),
    terminalState: text('terminal_state'),
    rejectReason: text('reject_reason'),
    lastError: text('last_error'),
    internalNotes: text('internal_notes'),
    retryCount: integer('retry_count').notNull().default(0),
    version: integer('version').notNull().default(0),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeUserUnique: uniqueIndex('manual_ops_one_active_per_user')
      .on(t.userId)
      .where(sql`${t.state} IN ${ACTIVE_STATES}`),
    activeMexUnique: uniqueIndex('manual_ops_one_active_per_mex_account')
      .on(t.mexAccountId)
      .where(sql`${t.state} IN ${ACTIVE_STATES}`),
    awaitingMatchIdx: index('manual_ops_awaiting_match_idx')
      .on(t.userId, t.fromAsset, t.fromNetwork, t.expectedDepositAmount)
      .where(sql`${t.state} = 'awaiting_deposit'`),
    workerIdx: index('manual_ops_worker_idx').on(t.state, t.lockedAt, t.createdAt),
    userIdx: index('manual_ops_user_idx').on(t.userId, t.createdAt),
    nominalPositive: check('manual_ops_nominal_positive', sql`${t.nominalAmount} > 0`),
    expectedPositive: check('manual_ops_expected_positive', sql`${t.expectedDepositAmount} > 0`),
    verifierCheck: check('manual_ops_verifier_check', sql`${t.verifierDigits} ~ '^[0-9]{2}$'`),
    sideCheck: check(
      'manual_ops_side_check',
      sql`${t.spotSide} IS NULL OR ${t.spotSide} IN ('BUY', 'SELL')`,
    ),
    stateCheck: check(
      'manual_ops_state_check',
      sql`${t.state} IN (
        'awaiting_deposit', 'awaiting_deposit_confirmation',
        'pending_user_confirm', 'pending_admin_confirm', 'pending_candidate_resolution',
        'converting', 'awaiting_conversion', 'withdrawing', 'awaiting_withdrawal',
        'refunding', 'awaiting_refund', 'on_hold',
        'done', 'failed', 'expired', 'cancelled'
      )`,
    ),
  }),
);

export type ManualOperation = typeof manualOperations.$inferSelect;
export type NewManualOperation = typeof manualOperations.$inferInsert;
