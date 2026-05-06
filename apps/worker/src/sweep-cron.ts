import { and, eq, gt, isNull, sql, sum } from 'drizzle-orm';
import type { Database } from '@rb/db';
import type { WorkerEnv } from '@rb/config';
import {
  bounceJobs,
  deposits,
  mexAccounts,
  platformSweepWallet,
  sweepRuns,
  withdrawals,
} from '@rb/db';
import { conversionClientOrderId, platformSweepOrderId } from '@rb/domain';
import cron from 'node-cron';
import { logger } from './logger';
import { runWithCorrelation, trace } from './correlation';
import { isMaintenanceActive } from './maintenance';
import { buildMexClient } from './mex-account';
import { MexBusinessError } from '@rb/mex-client';
import { randomUUID } from 'node:crypto';

const SWEEP_THRESHOLD = 5;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

export function startSweepCron({ db, env }: Ctx): () => void {
  if (!cron.validate(env.SWEEP_CRON)) {
    logger.warn({ cron: env.SWEEP_CRON }, 'invalid SWEEP_CRON; sweep disabled');
    return () => {};
  }
  const task = cron.schedule(env.SWEEP_CRON, async () => {
    try {
      if (await isMaintenanceActive(db)) {
        logger.info('sweep skipped: maintenance active');
        return;
      }
      await runSweep(db, env);
    } catch (err) {
      logger.error({ err }, 'sweep cron failed');
    }
  });
  task.start();
  logger.info({ cron: env.SWEEP_CRON }, 'sweep cron scheduled');
  return () => task.stop();
}

async function runSweep(db: Database, env: WorkerEnv) {
  const sweepRunId = randomUUID();
  await db.insert(sweepRuns).values({
    id: sweepRunId,
    status: 'running',
    startedAt: new Date(),
  });

  let totalSwept = 0;
  let failureCount = 0;

  await runWithCorrelation(
    db,
    {
      type: 'sweep',
      entityType: 'sweep_run',
      entityId: sweepRunId,
      summary: 'daily platform commission sweep',
    },
    async () => {
      const sweepWallet = await db.query.platformSweepWallet.findFirst({
        where: eq(platformSweepWallet.id, 1),
      });
      if (!sweepWallet?.address) {
        await trace(db, 'error', 'sweep_no_wallet', 'platform_sweep_wallet not configured');
        return;
      }

      // Find all bounced jobs whose platform commission has not been swept yet,
      // grouped by mex_account.
      const candidates = await db.execute<{ mex_account_id: string; total: string }>(sql`
        SELECT d.mex_account_id, COALESCE(SUM(b.platform_commission_amount), 0)::text AS total
        FROM bounce_jobs b
        JOIN deposits d ON d.id = b.deposit_id
        LEFT JOIN withdrawals sw ON sw.bounce_job_id = b.id AND sw.type = 'platform_sweep'
        WHERE b.state = 'done' AND sw.id IS NULL
        GROUP BY d.mex_account_id
      `);

      for (const row of candidates as unknown as Array<{ mex_account_id: string; total: string }>) {
        const total = Number(row.total);
        if (total < SWEEP_THRESHOLD) {
          await trace(db, 'debug', 'sweep_below_threshold', `account ${row.mex_account_id} total=${total}`);
          continue;
        }
        try {
          const swept = await sweepAccount(db, env, sweepRunId, row.mex_account_id, total, sweepWallet);
          totalSwept += swept;
        } catch (err) {
          failureCount += 1;
          await trace(db, 'error', 'sweep_account_failed', String(err), {
            mexAccountId: row.mex_account_id,
          });
        }
      }
    },
  );

  await db
    .update(sweepRuns)
    .set({
      finishedAt: new Date(),
      status: failureCount > 0 ? 'failed' : 'done',
      totalSwept: String(totalSwept),
    })
    .where(eq(sweepRuns.id, sweepRunId));
}

async function sweepAccount(
  db: Database,
  env: WorkerEnv,
  sweepRunId: string,
  mexAccountId: string,
  totalUsdEquivalent: number,
  sweepWallet: typeof platformSweepWallet.$inferSelect,
): Promise<number> {
  const mex = await db.query.mexAccounts.findFirst({ where: eq(mexAccounts.id, mexAccountId) });
  if (!mex) return 0;

  const client = buildMexClient(db, env, mex);
  const account = await client.getAccountInfo();

  // Strategy: convert non-USDT free balances to USDT (best-effort), then withdraw all
  // available USDT to sweep wallet on the configured network.
  for (const bal of account.balances) {
    const free = Number(bal.free);
    if (free <= 0) continue;
    if (bal.asset === sweepWallet.asset) continue;
    const symbol = `${bal.asset}${sweepWallet.asset}`; // e.g. BTCUSDT
    try {
      await client.newOrder({
        symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity: bal.free,
        newClientOrderId: conversionClientOrderId(`${sweepRunId}-${bal.asset}`),
      });
      await trace(db, 'info', 'sweep_converted', `${bal.free} ${bal.asset} -> ${sweepWallet.asset}`);
    } catch (err) {
      await trace(db, 'warn', 'sweep_convert_skipped', String(err), { asset: bal.asset });
    }
  }

  // Re-fetch sweep asset balance
  const after = await client.getAccountInfo();
  const usdt = after.balances.find((b) => b.asset === sweepWallet.asset);
  if (!usdt) return 0;
  const amount = Number(usdt.free);
  if (amount < SWEEP_THRESHOLD) {
    await trace(db, 'info', 'sweep_amount_below_threshold', `final=${amount}`);
    return 0;
  }

  const woid = platformSweepOrderId(sweepRunId, mexAccountId);
  // Two-phase: persist withdrawal first, then call MEX.
  await db.insert(withdrawals).values({
    mexAccountId,
    sweepRunId,
    type: 'platform_sweep',
    asset: sweepWallet.asset,
    network: sweepWallet.network,
    address: sweepWallet.address,
    memo: sweepWallet.memo,
    amount: usdt.free,
    withdrawOrderId: woid,
    status: 'pending',
  });

  try {
    const res = await client.withdraw({
      coin: sweepWallet.asset,
      network: sweepWallet.network,
      address: sweepWallet.address,
      amount: usdt.free,
      withdrawOrderId: woid,
      memo: sweepWallet.memo ?? undefined,
      remark: 'platform_sweep',
    });
    await db
      .update(withdrawals)
      .set({ mexWithdrawId: res.id, status: 'submitted' })
      .where(eq(withdrawals.withdrawOrderId, woid));
    await trace(db, 'info', 'sweep_submitted', `mexId=${res.id}`, { amount: usdt.free });
  } catch (err) {
    if (err instanceof MexBusinessError && err.isDedupHit) {
      await trace(db, 'info', 'sweep_dedup_hit', 'MEX already saw this woid');
    } else {
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .update(withdrawals)
        .set({ status: 'failed', error: reason })
        .where(eq(withdrawals.withdrawOrderId, woid));
      throw err;
    }
  }

  return amount;
}
