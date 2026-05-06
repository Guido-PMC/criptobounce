import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const operations = pgTable(
  'operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    userId: uuid('user_id'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    status: text('status').notNull().default('running'),
    failedAtStep: text('failed_at_step'),
    failedReason: text('failed_reason'),
    summary: text('summary'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
  (t) => ({
    userIdx: index('operations_user_idx').on(t.userId, t.startedAt),
    typeStatusIdx: index('operations_type_status_idx').on(t.type, t.status, t.startedAt),
    startedAtIdx: index('operations_started_at_idx').on(t.startedAt),
  }),
);

export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;

export const traceEvents = pgTable(
  'trace_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    operationId: uuid('operation_id').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    level: text('level').notNull(),
    step: text('step').notNull(),
    message: text('message').notNull(),
    payloadJson: jsonb('payload_json'),
  },
  (t) => ({
    opIdx: index('trace_events_op_idx').on(t.operationId, t.ts),
  }),
);

export type TraceEvent = typeof traceEvents.$inferSelect;
export type NewTraceEvent = typeof traceEvents.$inferInsert;

export const mexApiCalls = pgTable(
  'mex_api_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    method: text('method').notNull(),
    endpoint: text('endpoint').notNull(),
    requestParams: jsonb('request_params'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    responseMs: integer('response_ms'),
    error: text('error'),
    withdrawOrderId: text('withdraw_order_id'),
  },
  (t) => ({
    opIdx: index('mex_api_calls_op_idx').on(t.operationId, t.ts),
    woidIdx: index('mex_api_calls_woid_idx').on(t.withdrawOrderId),
    tsIdx: index('mex_api_calls_ts_idx').on(t.ts),
  }),
);

export type MexApiCall = typeof mexApiCalls.$inferSelect;
export type NewMexApiCall = typeof mexApiCalls.$inferInsert;

export const telegramMessages = pgTable(
  'telegram_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id'),
    userId: uuid('user_id'),
    chatId: text('chat_id'),
    direction: text('direction').notNull(),
    type: text('type').notNull(),
    rawPayload: jsonb('raw_payload'),
    sentOk: boolean('sent_ok'),
    error: text('error'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pendingIdx: index('telegram_messages_pending_idx').on(t.direction, t.sentOk, t.ts),
  }),
);

export type TelegramMessage = typeof telegramMessages.$inferSelect;
export type NewTelegramMessage = typeof telegramMessages.$inferInsert;

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    payload: jsonb('payload'),
    ipAddress: text('ip_address'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index('audit_log_actor_idx').on(t.actorId, t.ts),
    actionIdx: index('audit_log_action_idx').on(t.action, t.ts),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
