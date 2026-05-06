import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

/** Constant keys for system_settings */
export const SystemSettingKeys = {
  MAINTENANCE_MODE: 'maintenance_mode',
  MINIMUM_AMOUNTS: 'minimum_amounts',
  ASSET_NETWORK_STATUS: 'asset_network_status',
  NETWORK_FEES: 'network_fees',
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
