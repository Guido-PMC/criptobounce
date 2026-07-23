import type { WorkerEnv } from '@rb/config';
import type { Database } from '@rb/db';
import { mexAccounts, withdrawals } from '@rb/db';
import { MexBusinessError } from '@rb/mex-client';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { runWithCorrelation, trace } from './correlation';
import {
  claimFinancialAccountLease,
  isFinancialAccountLocked,
  releaseFinancialAccountLease,
} from './financial-account-lock';
import { logger } from './logger';
import { buildMexClient } from './mex-account';

const POLL_MS = 10_000;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

/**
 * Dispatches `manual_sweep` withdrawals queued by admin. Idempotent via the
 * existing UNIQUE(withdraw_order_id) constraint and dedup detection from MEX.
 */
export function startManualSweepDispatcher({ db, env }: Ctx): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runOnce(db, env);
    } catch (err) {
      logger.error({ err }, 'manual-sweep dispatcher iteration failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };
  timer = setTimeout(tick, 6000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function runOnce(db: Database, env: WorkerEnv) {
  const queued = await db
    .select()
    .from(withdrawals)
    .where(
      and(
        eq(withdrawals.type, 'manual_sweep'),
        eq(withdrawals.status, 'pending'),
        isNull(withdrawals.mexWithdrawId),
      ),
    )
    .orderBy(asc(withdrawals.createdAt))
    .limit(10);

  for (const w of queued) {
    if (!w.mexAccountId) continue;
    if (await isFinancialAccountLocked(db, w.mexAccountId)) {
      logger.info(
        { withdrawalId: w.id, mexAccountId: w.mexAccountId },
        'manual sweep deferred: manual operation holds financial account lock',
      );
      continue;
    }
    const mex = await db.query.mexAccounts.findFirst({ where: eq(mexAccounts.id, w.mexAccountId) });
    if (!mex) continue;
    const leaseOwner = `manual-sweep:${w.id}`;
    if (
      !(await claimFinancialAccountLease(
        db,
        w.mexAccountId,
        'manual_sweep',
        leaseOwner,
        30 * 60_000,
      ))
    ) {
      continue;
    }

    try {
      await runWithCorrelation(
        db,
        {
          type: 'manual_sweep',
          userId: w.userId ?? undefined,
          entityType: 'withdrawal',
          entityId: w.id,
          summary: `manual sweep ${w.amount} ${w.asset} ${w.network}`,
        },
        async () => {
          const client = buildMexClient(db, env, mex);
          try {
            const res = await client.withdraw({
              coin: w.asset,
              network: w.network,
              address: w.address,
              amount: w.amount,
              withdrawOrderId: w.withdrawOrderId,
              memo: w.memo ?? undefined,
              remark: 'manual_sweep',
            });
            await db
              .update(withdrawals)
              .set({ mexWithdrawId: res.id, status: 'submitted' })
              .where(eq(withdrawals.id, w.id));
            await trace(db, 'info', 'manual_sweep_submitted', `mexId=${res.id}`);
          } catch (err) {
            if (err instanceof MexBusinessError && err.isDedupHit) {
              await trace(db, 'info', 'manual_sweep_dedup_hit', 'MEX already saw this');
              return;
            }
            const reason = err instanceof Error ? err.message : String(err);
            await db
              .update(withdrawals)
              .set({ status: 'failed', error: reason })
              .where(eq(withdrawals.id, w.id));
            await trace(db, 'error', 'manual_sweep_failed', reason);
          }
        },
      );
    } finally {
      await releaseFinancialAccountLease(db, w.mexAccountId, leaseOwner);
    }
  }
}
