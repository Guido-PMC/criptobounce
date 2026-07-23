import { randomUUID } from 'node:crypto';
import type { WorkerEnv } from '@rb/config';
import type { Database } from '@rb/db';
import { type Deposit, type MexAccount, bounceJobs, deposits, mexAccounts, users } from '@rb/db';
import { ASSETS, mapMexToInternal } from '@rb/domain';
import { userPayoutOrderId } from '@rb/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { runWithCorrelation, trace } from './correlation';
import { logger } from './logger';
import { isMaintenanceActive } from './maintenance';
import { tryMatchManualOperation } from './manual-operation-match';
import { buildMexClient } from './mex-account';
import { notify, tpl } from './notifier';

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

const MEX_DEPOSIT_STATUS_CONFIRMED = new Set([5, 6]); // 5 = credited, 6 = success

export function startDepositWatcher({ db, env }: Ctx): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runOnce(db, env);
    } catch (err) {
      logger.error({ err }, 'deposit-watcher iteration failed');
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, env.DEPOSIT_POLL_INTERVAL_SEC * 1000);
      }
    }
  };
  timer = setTimeout(tick, 1000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function runOnce(db: Database, env: WorkerEnv) {
  const accounts = await db
    .select({
      id: mexAccounts.id,
      userId: mexAccounts.userId,
      mexEmail: mexAccounts.mexEmail,
      apiKeyEnc: mexAccounts.apiKeyEnc,
      apiSecretEnc: mexAccounts.apiSecretEnc,
      ipWhitelisted: mexAccounts.ipWhitelisted,
      status: mexAccounts.status,
      lastBalanceSync: mexAccounts.lastBalanceSync,
      balanceCache: mexAccounts.balanceCache,
      createdAt: mexAccounts.createdAt,
      updatedAt: mexAccounts.updatedAt,
      userStatus: users.status,
      userIsPaused: users.isPaused,
      userPausedAssets: users.pausedAssets,
    })
    .from(mexAccounts)
    .innerJoin(users, eq(users.id, mexAccounts.userId))
    .where(
      and(eq(mexAccounts.status, 'active'), eq(users.status, 'approved'), isNull(users.deletedAt)),
    );

  for (const acc of accounts) {
    try {
      await pollAccount(
        db,
        env,
        acc as unknown as MexAccount,
        acc.userIsPaused,
        acc.userPausedAssets,
      );
    } catch (err) {
      logger.warn({ err, mexAccountId: acc.id }, 'pollAccount failed');
    }
  }
}

async function pollAccount(
  db: Database,
  env: WorkerEnv,
  acc: MexAccount,
  userIsPaused: boolean,
  userPausedAssets: string[],
) {
  const client = buildMexClient(db, env, acc);
  await runWithCorrelation(
    db,
    {
      type: 'deposit_poll',
      userId: acc.userId,
      entityType: 'mex_account',
      entityId: acc.id,
      summary: `poll deposits ${acc.mexEmail}`,
    },
    async () => {
      for (const asset of ASSETS) {
        let history: Awaited<ReturnType<typeof client.getDepositHistory>> = [];
        try {
          history = await client.getDepositHistory({ coin: asset, limit: 50 });
        } catch (err) {
          await trace(db, 'warn', 'get_deposit_history_failed', `asset ${asset}`, {
            asset,
            error: err instanceof Error ? err.message : String(err),
          });
          logger.warn({ err, asset, mexAccountId: acc.id }, 'getDepositHistory failed');
          continue;
        }

        for (const item of history) {
          try {
            await processDeposit(db, env, acc, item, userIsPaused, userPausedAssets);
          } catch (err) {
            await trace(db, 'error', 'process_deposit_failed', `${item.coin} ${item.network}`, {
              mexTxId: item.txId,
              asset,
              error: err instanceof Error ? err.message : String(err),
            });
            logger.error({ err, mexTxId: item.txId, asset }, 'processDeposit failed');
          }
        }
      }
    },
  );
}

type MexDepositItem = Awaited<
  ReturnType<ReturnType<typeof buildMexClient>['getDepositHistory']>
>[number];

async function processDeposit(
  db: Database,
  _env: WorkerEnv,
  acc: MexAccount,
  item: MexDepositItem,
  userIsPaused: boolean,
  userPausedAssets: string[],
) {
  // Map MEX raw identifiers to our internal asset/network. If MEX returns a chain
  // we don't support (or don't recognize) skip — we won't be able to route or
  // pick fees for it anyway.
  const mapped = mapMexToInternal(item.coin, item.network);
  if (!mapped) {
    logger.warn(
      { mexCoin: item.coin, mexNetwork: item.network, mexTxId: item.txId },
      'unsupported MEX coin/network; skipping deposit',
    );
    return;
  }

  // Existing?
  const existing = await db.query.deposits.findFirst({
    where: and(eq(deposits.mexAccountId, acc.id), eq(deposits.mexTxId, item.txId)),
  });

  const isConfirmed = MEX_DEPOSIT_STATUS_CONFIRMED.has(item.status);

  if (!existing) {
    // First time we see this deposit. Insert.
    let inserted: Deposit | undefined;
    try {
      const rows = await db
        .insert(deposits)
        .values({
          userId: acc.userId,
          mexAccountId: acc.id,
          asset: mapped.asset,
          network: mapped.network,
          amount: item.amount,
          amountRaw: item.amount,
          mexTxId: item.txId,
          onChainTx: item.txId,
          status: isConfirmed ? 'confirmed' : 'detected',
          confirmedAt: isConfirmed ? new Date() : null,
        })
        .returning();
      inserted = rows[0];
    } catch (err) {
      // Race: another worker inserted just now. Skip.
      logger.debug({ err }, 'deposit insert race ignored');
      return;
    }
    if (!inserted) return;

    await runWithCorrelation(
      db,
      {
        type: 'deposit_bounce',
        userId: acc.userId,
        entityType: 'deposit',
        entityId: inserted.id,
        summary: `${item.amount} ${mapped.asset} ${mapped.network}`,
      },
      async () => {
        await trace(
          db,
          'info',
          'detect_deposit',
          `${item.amount} ${mapped.asset} ${mapped.network}`,
          {
            status: item.status,
            mexCoin: item.coin,
            mexNetwork: item.network,
          },
        );
        await notify(db, {
          type: 'deposit_detected',
          userId: acc.userId,
          text: tpl.depositDetected(mapped.asset, mapped.network, item.amount),
        });
        const manualMatch = await tryMatchManualOperation(
          db,
          acc.userId,
          inserted!,
          new Date(item.insertTime),
          isConfirmed,
        );
        if (isConfirmed) {
          if (manualMatch.action === 'none') {
            await maybeEnqueueBounce(db, acc.userId, inserted!, userIsPaused, userPausedAssets);
          }
        }
      },
    );
    return;
  }

  // Existing: maybe transition detected -> confirmed
  if (existing.status === 'detected' && isConfirmed) {
    await db
      .update(deposits)
      .set({
        status: 'confirmed',
        amountRaw: item.amount,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deposits.id, existing.id));

    await runWithCorrelation(
      db,
      {
        type: 'deposit_bounce',
        userId: acc.userId,
        entityType: 'deposit',
        entityId: existing.id,
        summary: `${existing.amount} ${existing.asset} ${existing.network}`,
      },
      async () => {
        await trace(db, 'info', 'confirm_deposit', 'deposit confirmed by MEX');
        await notify(db, {
          type: 'deposit_confirmed',
          userId: acc.userId,
          text: tpl.depositConfirmed(existing.asset, existing.network, existing.amount),
        });
        const manualMatch = await tryMatchManualOperation(
          db,
          acc.userId,
          { ...existing, amountRaw: item.amount },
          new Date(item.insertTime),
          true,
        );
        if (manualMatch.action === 'none') {
          await maybeEnqueueBounce(db, acc.userId, existing, userIsPaused, userPausedAssets);
        }
      },
    );
    return;
  }

  // Re-run the manual matcher for already-confirmed rows. Besides making MEX
  // polling idempotent, this recovers cleanly from a concurrent candidate
  // selection race or a worker crash after confirming the deposit.
  if (existing.status === 'confirmed' && isConfirmed) {
    const manualMatch = await tryMatchManualOperation(
      db,
      acc.userId,
      { ...existing, amountRaw: item.amount },
      new Date(item.insertTime),
      true,
    );
    if (manualMatch.action === 'none') {
      await maybeEnqueueBounce(db, acc.userId, existing, userIsPaused, userPausedAssets);
    }
  }
}

async function maybeEnqueueBounce(
  db: Database,
  _userId: string,
  dep: Deposit,
  userIsPaused: boolean,
  userPausedAssets: string[],
) {
  if (await isMaintenanceActive(db)) {
    await trace(db, 'info', 'maintenance_skip', 'maintenance active, will not enqueue');
    return;
  }
  if (userIsPaused) {
    await trace(db, 'info', 'user_paused_skip', 'user has global pause');
    return;
  }
  if (userPausedAssets.includes(dep.asset)) {
    await trace(db, 'info', 'asset_paused_skip', `asset ${dep.asset} paused for user`);
    return;
  }

  // Idempotent: bounce_jobs.deposit_id is UNIQUE
  try {
    const jobId = randomUUID();
    await db.insert(bounceJobs).values({
      id: jobId,
      depositId: dep.id,
      withdrawOrderId: userPayoutOrderId(jobId),
      state: 'pending',
    });
    await trace(db, 'info', 'job_enqueued', 'bounce_job created', { jobId });
  } catch (err) {
    logger.debug({ err, depositId: dep.id }, 'bounce_job already exists');
  }
}
