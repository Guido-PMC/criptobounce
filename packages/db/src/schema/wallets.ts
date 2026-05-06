import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const destinationWallets = pgTable(
  'destination_wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    asset: text('asset').notNull(),
    network: text('network').notNull(),
    address: text('address').notNull(),
    memo: text('memo'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('destination_wallets_user_idx').on(t.userId),
    defaultUnique: uniqueIndex('destination_wallets_default_uq')
      .on(t.userId, t.asset, t.network)
      .where(sql`${t.isDefault} = true AND ${t.deletedAt} IS NULL`),
  }),
);

export type DestinationWallet = typeof destinationWallets.$inferSelect;
export type NewDestinationWallet = typeof destinationWallets.$inferInsert;

export const routingRules = pgTable(
  'routing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromAsset: text('from_asset'),
    fromNetwork: text('from_network'),
    toAsset: text('to_asset').notNull(),
    toNetwork: text('to_network').notNull(),
    destinationWalletId: uuid('destination_wallet_id')
      .notNull()
      .references(() => destinationWallets.id, { onDelete: 'restrict' }),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('routing_rules_user_idx').on(t.userId, t.priority),
  }),
);

export type RoutingRule = typeof routingRules.$inferSelect;
export type NewRoutingRule = typeof routingRules.$inferInsert;
