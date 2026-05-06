import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Database } from '@rb/db';
import type { WorkerEnv } from '@rb/config';
import { bounceJobs, deposits, mexAccounts, withdrawals } from '@rb/db';
import { logger } from './logger';
import { runWithCorrelation, trace } from './correlation';
import { buildMexClient } from './mex-account';

const STALE_PENDING_MS = 60_000;
const STALE_SUBMITTED_MS = 5 * 60_000;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

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
        and(
          inArray(withdrawals.status, ['pending', 'submitted']),
          lt(withdrawals.createdAt, cutoffSubmitted),
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

async function reconcileOne(
  db: Database,
  env: WorkerEnv,
  w: typeof withdrawals.$inferSelect,
) {
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
    });
    await trace(db, 'info', 'reconciled_success', 'withdrawal succeeded', {
      withdrawOrderId: w.withdrawOrderId,
    });
  } else if (found.status === 8 || found.status === 2) {
    await db
      .update(withdrawals)
      .set({
        status: 'failed',
        mexWithdrawId: found.id,
        reconciledAt: new Date(),
        error: `MEX status=${found.status}`,
      })
      .where(eq(withdrawals.id, w.id));
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
