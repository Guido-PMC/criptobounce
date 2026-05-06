import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Database } from '@rb/db';
import { operations, traceEvents } from '@rb/db';
import type { OperationType, TraceLevel } from '@rb/domain';
import { eq } from 'drizzle-orm';

interface CorrelationCtx {
  operationId: string;
  type: OperationType;
}

const als = new AsyncLocalStorage<CorrelationCtx>();

export function currentCorrelationId(): string | undefined {
  return als.getStore()?.operationId;
}

export interface RunWithCorrelationOpts {
  type: OperationType;
  userId?: string | null;
  entityType?: string;
  entityId?: string | null;
  summary?: string;
}

/**
 * Wrap a unit of work with a correlation_id.
 * Creates an `operations` row at start, updates status/duration on completion.
 */
export async function runWithCorrelation<T>(
  db: Database,
  opts: RunWithCorrelationOpts,
  fn: (ctx: { operationId: string }) => Promise<T>,
): Promise<T> {
  const operationId = randomUUID();
  const startedAt = Date.now();

  await db.insert(operations).values({
    id: operationId,
    type: opts.type,
    userId: opts.userId ?? null,
    entityType: opts.entityType ?? null,
    entityId: opts.entityId ?? null,
    status: 'running',
    summary: opts.summary ?? null,
  });

  try {
    const result = await als.run({ operationId, type: opts.type }, () =>
      fn({ operationId }),
    );
    await db
      .update(operations)
      .set({
        status: 'succeeded',
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      })
      .where(eq(operations.id, operationId));
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(operations)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        failedReason: reason,
      })
      .where(eq(operations.id, operationId));
    await trace(db, 'error', 'operation_failed', reason, { stack: err instanceof Error ? err.stack : undefined });
    throw err;
  }
}

export async function trace(
  db: Database,
  level: TraceLevel,
  step: string,
  message: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const ctx = als.getStore();
  if (!ctx) return;
  await db.insert(traceEvents).values({
    operationId: ctx.operationId,
    level,
    step,
    message,
    payloadJson: payload ?? null,
  });
}

export async function markOperationOnHold(
  db: Database,
  step: string,
  reason: string,
): Promise<void> {
  const ctx = als.getStore();
  if (!ctx) return;
  await db
    .update(operations)
    .set({ status: 'on_hold', failedAtStep: step, failedReason: reason, finishedAt: new Date() })
    .where(eq(operations.id, ctx.operationId));
}
