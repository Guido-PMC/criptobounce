import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramId: bigint('telegram_id', { mode: 'number' }).unique(),
    telegramUsername: text('telegram_username'),
    googleEmail: text('google_email').unique(),
    role: text('role').notNull().default('user'),
    status: text('status').notNull().default('pending'),
    isPaused: boolean('is_paused').notNull().default(false),
    pausedAssets: text('paused_assets').array().notNull().default(sql`ARRAY[]::text[]`),
    /**
     * Cosmetic spread (0..0.05 = 0..5%) applied ONLY when rendering the
     * operation receipt for non-USDT->USDT bounces. It does NOT affect the
     * actual on-chain amounts, only the displayed rate / amount-out on the
     * receipt. Snapshot to bounce_jobs.receipt_spread_percent at completion
     * so generated receipts stay stable if the user adjusts the slider later.
     */
    receiptSpreadPercent: numeric('receipt_spread_percent', { precision: 6, scale: 5 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references((): AnyPgColumn => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('users_status_idx').on(t.status),
    deletedAtIdx: index('users_deleted_at_idx').on(t.deletedAt),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: index('invitations_token_idx').on(t.token),
    userIdx: index('invitations_user_idx').on(t.userId),
  }),
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

export const admin2fa = pgTable('admin_2fa', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  totpSecretEnc: text('totp_secret_enc').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  recoveryCodesEnc: text('recovery_codes_enc'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Admin2fa = typeof admin2fa.$inferSelect;
