import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const userCommissions = pgTable(
  'user_commissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    asset: text('asset').notNull().default('*'), // '*' = default
    percent: numeric('percent', { precision: 6, scale: 5 }).notNull().default('0'),
    fixedAmount: numeric('fixed_amount', { precision: 20, scale: 8 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.asset] }),
  }),
);

export type UserCommission = typeof userCommissions.$inferSelect;
export type NewUserCommission = typeof userCommissions.$inferInsert;

export const platformCommissions = pgTable(
  'platform_commissions',
  {
    asset: text('asset').primaryKey(),
    percent: numeric('percent', { precision: 6, scale: 5 }).notNull().default('0'),
    fixedAmount: numeric('fixed_amount', { precision: 20, scale: 8 }).notNull().default('0'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type PlatformCommission = typeof platformCommissions.$inferSelect;
export type NewPlatformCommission = typeof platformCommissions.$inferInsert;

/**
 * Single-row table holding the master sweep wallet configuration.
 */
export const platformSweepWallet = pgTable(
  'platform_sweep_wallet',
  {
    id: integer('id').primaryKey().default(1),
    asset: text('asset').notNull().default('USDT'),
    network: text('network').notNull().default('TRC20'),
    address: text('address').notNull(),
    memo: text('memo'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    singletonCheck: check('platform_sweep_wallet_singleton', sql`${t.id} = 1`),
  }),
);

export type PlatformSweepWallet = typeof platformSweepWallet.$inferSelect;
