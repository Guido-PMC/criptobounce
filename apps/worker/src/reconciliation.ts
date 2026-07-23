import type { WorkerEnv } from '@rb/config';
import type { Database } from '@rb/db';
import {
  bounceJobs,
  deposits,
  manualOperationDeposits,
  manualOperations,
  mexAccounts,
  withdrawals,
} from '@rb/db';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { runWithCorrelation, trace } from './correlation';
import { logger } from './logger';
import { buildMexClient } from './mex-account';
import { notify, tpl } from './notifier';

const STALE_PENDING_MS = 60_000;
const STALE_SUBMITTED_MS = 5 * 60_000;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function startReconciliation({ db, env }: Ctx): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runOnce(db, env);
    } catch (err) {
      logger.error({ err }, 'reconciliation iteration failed');
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, env.RECONCILIATION_INTERVAL_SEC * 1000);
      }
    }
  };
  timer = setTimeout(tick, 5000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function runOnce(db: Database, env: WorkerEnv) {
  await runWithCorrelation(db, { type: 'reconciliation' }, async () => {
    const cutoffPending = new Date(Date.now() - STALE_PENDING_MS);
    const cutoffSubmitted = new Date(Date.now() - STALE_SUBMITTED_MS);

    const stale = await db
      .select()
      .from(withdrawals)
      .where(
        or(
          and(eq(withdrawals.status, 'pending'), lt(withdrawals.createdAt, cutoffPending)),
          and(eq(withdrawals.status, 'submitted'), lt(withdrawals.createdAt, cutoffSubmitted)),
        ),
      )
      .limit(50);

    await trace(db, 'info', 'reconcile_start', `stale withdrawals: ${stale.length}`);
    for (const w of stale) {
      try {
        await reconcileOne(db, env, w);
      } catch (err) {
        await trace(db, 'warn', 'reconcile_one_failed', String(err), {
          withdrawOrderId: w.withdrawOrderId,
        });
      }
    }
  });
}

async function reconcileOne(db: Database, env: WorkerEnv, w: typeof withdrawals.$inferSelect) {
  if (!w.mexAccountId) return;
  const mex = await db.query.mexAccounts.findFirst({ where: eq(mexAccounts.id, w.mexAccountId) });
  if (!mex) return;

  const client = buildMexClient(db, env, mex);
  const history = await client.getWithdrawHistory({ withdrawOrderId: w.withdrawOrderId, limit: 5 });
  const found = history.find((h) => h.withdrawOrderId === w.withdrawOrderId);
  if (!found) {
    await trace(db, 'debug', 'reconcile_not_found', 'still missing in MEX', {
      withdrawOrderId: w.withdrawOrderId,
    });
    return;
  }

  // Update withdrawal + corresponding bounce_job
  if (found.status === 7) {
    await db.transaction(async (tx) => {
      await tx
        .update(withdrawals)
        .set({
          status: 'success',
          mexWithdrawId: found.id,
          onChainTx: found.txId ?? null,
          fee: found.transactionFee != null ? String(found.transactionFee) : null,
          reconciledAt: new Date(),
        })
        .where(eq(withdrawals.id, w.id));
      if (w.bounceJobId) {
        await tx
          .update(bounceJobs)
          .set({ state: 'done', lockedAt: null, lockedBy: null, updatedAt: new Date() })
          .where(eq(bounceJobs.id, w.bounceJobId));
        const job = await tx.query.bounceJobs.findFirst({
          where: eq(bounceJobs.id, w.bounceJobId),
        });
        if (job) {
          await tx
            .update(deposits)
            .set({ status: 'bounced' })
            .where(eq(deposits.id, job.depositId));
        }
      }
      if (w.manualOperationId) {
        if (w.type === 'manual_operation_refund') {
          await tx
            .update(manualOperationDeposits)
            .set({ status: 'refunded', updatedAt: new Date() })
            .where(
              and(
                eq(manualOperationDeposits.manualOperationId, w.manualOperationId),
                eq(manualOperationDeposits.status, 'selected'),
              ),
            );
        }
        await advanceManualOperationAfterWithdrawal(tx, w);
      }
    });
    if (w.manualOperationId) {
      const op = await db.query.manualOperations.findFirst({
        where: eq(manualOperations.id, w.manualOperationId),
      });
      if (
        op?.state === 'done' ||
        op?.state === 'cancelled' ||
        op?.state === 'pending_candidate_resolution'
      ) {
        await notify(db, {
          type:
            op.state === 'done'
              ? 'manual_op_done'
              : op.state === 'cancelled'
                ? 'manual_op_cancelled'
                : 'manual_op_candidate_resolution',
          userId: op.userId,
          text:
            op.state === 'done'
              ? tpl.manualDone(op.executedOutput ?? '0', op.toAsset)
              : op.state === 'cancelled'
                ? tpl.manualCancelled()
                : tpl.manualCandidateResolution(),
          dedupeKey: `manual-op:${op.id}:${op.state}`,
        });
      }
    }
    await trace(db, 'info', 'reconciled_success', 'withdrawal succeeded', {
      withdrawOrderId: w.withdrawOrderId,
    });
  } else if (found.status === 8 || found.status === 2) {
    await db.transaction(async (tx) => {
      await tx
        .update(withdrawals)
        .set({
          status: 'failed',
          mexWithdrawId: found.id,
          reconciledAt: new Date(),
          error: `MEX status=${found.status}`,
        })
        .where(eq(withdrawals.id, w.id));
      if (w.manualOperationId) {
        await tx
          .update(manualOperations)
          .set({
            state: 'on_hold',
            resumeState: w.type === 'manual_operation_refund' ? 'refunding' : 'withdrawing',
            lastError: `withdrawal failed at MEX (status=${found.status})`,
            retryCount: sql`${manualOperations.retryCount} + 1`,
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(eq(manualOperations.id, w.manualOperationId));
      }
    });
    if (w.manualOperationId) {
      const op = await db.query.manualOperations.findFirst({
        where: eq(manualOperations.id, w.manualOperationId),
      });
      if (op) {
        await notify(db, {
          type: 'manual_op_on_hold',
          userId: op.userId,
          text: tpl.manualOnHold(`retiro rechazado por MEX (status=${found.status})`),
          dedupeKey: `manual-op:${op.id}:withdraw-failed:${w.id}`,
        });
      }
    }
    await trace(db, 'warn', 'reconciled_failure', `MEX status=${found.status}`, {
      withdrawOrderId: w.withdrawOrderId,
    });
  } else {
    await db
      .update(withdrawals)
      .set({
        status: 'submitted',
        mexWithdrawId: found.id,
        reconciledAt: new Date(),
      })
      .where(eq(withdrawals.id, w.id));
  }
}

async function advanceManualOperationAfterWithdrawal(
  tx: DbTransaction,
  withdrawal: typeof withdrawals.$inferSelect,
): Promise<void> {
  if (!withdrawal.manualOperationId) return;
  const op = await tx.query.manualOperations.findFirst({
    where: eq(manualOperations.id, withdrawal.manualOperationId),
  });
  if (!op) return;

  if (withdrawal.type === 'manual_operation_payout') {
    const hasSurplus = Number(op.surplusAmount ?? '0') > 0;
    if (hasSurplus && op.refundWalletId && op.refundAddress) {
      await tx
        .update(manualOperations)
        .set({ state: 'refunding', updatedAt: new Date(), lockedAt: null, lockedBy: null })
        .where(
          and(eq(manualOperations.id, op.id), eq(manualOperations.state, 'awaiting_withdrawal')),
        );
      return;
    }
  } else if (withdrawal.type !== 'manual_operation_refund') {
    return;
  }

  const unresolved = await tx
    .select({ id: manualOperationDeposits.id })
    .from(manualOperationDeposits)
    .where(
      and(
        eq(manualOperationDeposits.manualOperationId, op.id),
        eq(manualOperationDeposits.status, 'candidate'),
      ),
    );
  const nextState =
    unresolved.length > 0
      ? 'pending_candidate_resolution'
      : op.terminalState === 'cancelled'
        ? 'cancelled'
        : 'done';
  await tx
    .update(manualOperations)
    .set({
      state: nextState,
      completedAt: nextState === 'done' || nextState === 'cancelled' ? new Date() : null,
      cancelledAt: nextState === 'cancelled' ? new Date() : op.cancelledAt,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(manualOperations.id, op.id),
        inArray(manualOperations.state, ['awaiting_withdrawal', 'awaiting_refund']),
      ),
    );
}
