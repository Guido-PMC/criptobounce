import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { mexAccounts } from './mex';
import { users } from './users';

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;

export const workerLocks = pgTable('worker_locks', {
  name: text('name').primaryKey(),
  lockedBy: text('locked_by').notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkerLock = typeof workerLocks.$inferSelect;

export const financialAccountLocks = pgTable('financial_account_locks', {
  mexAccountId: uuid('mex_account_id')
    .primaryKey()
    .references(() => mexAccounts.id, { onDelete: 'cascade' }),
  ownerType: text('owner_type').notNull(),
  ownerId: text('owner_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Constant keys for system_settings */
export const SystemSettingKeys = {
  MAINTENANCE_MODE: 'maintenance_mode',
  MINIMUM_AMOUNTS: 'minimum_amounts',
  ASSET_NETWORK_STATUS: 'asset_network_status',
  NETWORK_FEES: 'network_fees',
  MANUAL_OPS_ADMIN_CHAT_ID: 'manual_ops_admin_chat_id',
} as const;

export interface MaintenanceModeValue {
  enabled: boolean;
  reason?: string;
  startedAt?: string;
  scheduledUntil?: string | null;
}

export interface MinimumAmountsValue {
  /** asset -> minimum NET amount required to bounce */
  [asset: string]: number;
}

export interface NetworkFeesValue {
  /** "ASSET-NETWORK" -> fee in asset units */
  [pair: string]: number;
}
