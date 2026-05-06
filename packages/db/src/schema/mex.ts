import {
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return value as Buffer;
  },
});

export const mexAccounts = pgTable(
  'mex_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    mexEmail: text('mex_email').notNull(),
    apiKeyEnc: bytea('api_key_enc').notNull(),
    apiSecretEnc: bytea('api_secret_enc').notNull(),
    ipWhitelisted: text('ip_whitelisted').notNull().default('no'),
    status: text('status').notNull().default('active'),
    lastBalanceSync: timestamp('last_balance_sync', { withTimezone: true }),
    balanceCache: jsonb('balance_cache'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('mex_accounts_status_idx').on(t.status),
  }),
);

export type MexAccount = typeof mexAccounts.$inferSelect;
export type NewMexAccount = typeof mexAccounts.$inferInsert;

export const mexDepositAddresses = pgTable(
  'mex_deposit_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mexAccountId: uuid('mex_account_id')
      .notNull()
      .references(() => mexAccounts.id, { onDelete: 'cascade' }),
    coin: text('coin').notNull(),
    network: text('network').notNull(),
    /**
     * 'ok'         - address fetched and ready to receive deposits
     * 'pending'    - MEX hasn't generated the address yet (auto-generation in flight or not attempted)
     * 'generating' - POST /capital/deposit/address in flight
     * 'error'      - last sync attempt failed; see lastError
     */
    status: text('status').notNull().default('pending'),
    address: text('address'),
    memo: text('memo'),
    lastError: text('last_error'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex('mex_deposit_addresses_pair_idx').on(
      t.mexAccountId,
      t.coin,
      t.network,
    ),
    accountIdx: index('mex_deposit_addresses_account_idx').on(t.mexAccountId),
  }),
);

export type MexDepositAddress = typeof mexDepositAddresses.$inferSelect;
export type NewMexDepositAddress = typeof mexDepositAddresses.$inferInsert;
