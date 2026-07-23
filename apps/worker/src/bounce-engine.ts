import type { WorkerEnv } from '@rb/config';
import type { Database } from '@rb/db';
import { type BounceJob, bounceJobs, deposits, mexAccounts, users, withdrawals } from '@rb/db';
import { type Asset, type Network, calculateBounce, conversionClientOrderId } from '@rb/domain';
import { MexBusinessError } from '@rb/mex-client';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { runWithCorrelation, trace } from './correlation';
import {
  claimFinancialAccountLease,
  isFinancialAccountLocked,
  releaseFinancialAccountLease,
} from './financial-account-lock';
import { getPlatformCommission, getUserCommission } from './lib/commissions';
import { getCachedCapitalConfig, resolveMexNetwork } from './lib/mex-network-resolver';
import { getMinimumNet } from './lib/minimums';
import { getLiveNetworkFee, getNetworkFee } from './lib/network-fees';
import { resolveRoute } from './lib/routing';
import {
  baseQuantityDecimals,
  getSpotSymbolInfo,
  quoteQuantityDecimals,
  symbolMinNotional,
  truncateToDecimals,
} from './lib/spot-precision';
import { logger } from './logger';
import { isMaintenanceActive } from './maintenance';
import { buildMexClient } from './mex-account';
import { notify, tpl } from './notifier';

const LEASE_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRIES = 5;
const PROCESSABLE_STATES = [
  'pending',
  'converting',
  'awaiting_conversion',
  'withdrawing',
  'awaiting_withdrawal',
] as const;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

export function startBounceEngine({ db, env }: Ctx): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      if (await isMaintenanceActive(db)) {
        // Maintenance: do not pull new jobs. In-flight jobs (already leased) finish in their own context.
        return;
      }
      await processBatch(db, env);
    } catch (err) {
      logger.error({ err }, 'bounce-engine iteration failed');
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, env.BOUNCE_LOOP_INTERVAL_SEC * 1000);
      }
    }
  };
  timer = setTimeout(tick, 2000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function processBatch(db: Database, env: WorkerEnv) {
  const leased = await leaseJobs(db, env.WORKER_ID, 10);
  for (const job of leased) {
    try {
      await processJob(db, env, job);
    } catch (err) {
      logger.error(
        { err, jobId: job.id, jobState: job.state, jobSnapshot: job },
        'processJob failed',
      );
    } finally {
      // Always release the lease after the iteration. State machine handlers
      // already updated bounce_jobs.state; we just need to free the worker
      // slot so the next tick can pick the job up immediately (instead of
      // waiting for the 5-min stale-lease cutoff).
      try {
        await db
          .update(bounceJobs)
          .set({ lockedBy: null, lockedAt: null })
          .where(eq(bounceJobs.id, job.id));
      } catch (releaseErr) {
        logger.warn({ err: releaseErr, jobId: job.id }, 'failed to release job lease');
      }
    }
  }
}

/**
 * IDEMPOTENCY LAYER 2: Pessimistic lease via UPDATE ... RETURNING.
 *
 * SELECT FOR UPDATE SKIP LOCKED + version increment ensures only one worker
 * grabs each job. Stale leases (>5min) are reclaimed automatically.
 */
async function leaseJobs(db: Database, workerId: string, batchSize: number): Promise<BounceJob[]> {
  const cutoff = new Date(Date.now() - LEASE_TIMEOUT_MS);
  // SQL hand-rolled: pick jobs in processable states whose lease is null or stale.
  // db.execute returns raw postgres-js rows with snake_case columns and string
  // timestamps — we have to remap into the camelCased BounceJob shape ourselves.
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT id FROM bounce_jobs
      WHERE state = ANY(${sql.raw(`ARRAY['${PROCESSABLE_STATES.join("','")}']::text[]`)})
        AND (locked_at IS NULL OR locked_at < ${cutoff.toISOString()}::timestamptz)
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    UPDATE bounce_jobs
    SET locked_by = ${workerId},
        locked_at = now(),
        version = version + 1
    WHERE id IN (SELECT id FROM candidates)
    RETURNING *;
  `);

  return (result as unknown as RawBounceRow[]).map(toBounceJob);
}

interface RawBounceRow {
  id: string;
  deposit_id: string;
  state: string;
  withdraw_order_id: string;
  conversion_order_id: string | null;
  conversion_symbol: string | null;
  destination_wallet_id: string | null;
  user_amount_gross: string | null;
  user_amount_after_conv: string | null;
  user_commission_amount: string | null;
  platform_commission_amount: string | null;
  network_fee_estimated: string | null;
  user_amount_net: string | null;
  receipt_spread_percent: string | null;
  receipt_calc_version: number | null;
  retry_count: number;
  last_error: string | null;
  on_hold_reason: string | null;
  version: number;
  locked_by: string | null;
  locked_at: string | Date | null;
  correlation_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function toBounceJob(r: RawBounceRow): BounceJob {
  return {
    id: r.id,
    depositId: r.deposit_id,
    state: r.state,
    withdrawOrderId: r.withdraw_order_id,
    conversionOrderId: r.conversion_order_id,
    conversionSymbol: r.conversion_symbol,
    destinationWalletId: r.destination_wallet_id,
    userAmountGross: r.user_amount_gross,
    userAmountAfterConv: r.user_amount_after_conv,
    userCommissionAmount: r.user_commission_amount,
    platformCommissionAmount: r.platform_commission_amount,
    networkFeeEstimated: r.network_fee_estimated,
    userAmountNet: r.user_amount_net,
    receiptSpreadPercent: r.receipt_spread_percent,
    receiptCalcVersion: r.receipt_calc_version,
    retryCount: r.retry_count,
    lastError: r.last_error,
    onHoldReason: r.on_hold_reason,
    version: r.version,
    lockedBy: r.locked_by,
    lockedAt: r.locked_at ? new Date(r.locked_at as string) : null,
    correlationId: r.correlation_id,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

async function processJob(db: Database, env: WorkerEnv, job: BounceJob) {
  const dep = await db.query.deposits.findFirst({ where: eq(deposits.id, job.depositId) });
  if (!dep) {
    logger.warn({ jobId: job.id }, 'deposit not found, marking failed');
    await db
      .update(bounceJobs)
      .set({ state: 'failed', lastError: 'deposit not found' })
      .where(eq(bounceJobs.id, job.id));
    return;
  }
  if (await isFinancialAccountLocked(db, dep.mexAccountId)) {
    logger.info(
      { jobId: job.id, mexAccountId: dep.mexAccountId },
      'bounce deferred: manual operation holds financial account lock',
    );
    return;
  }

  const mex = await db.query.mexAccounts.findFirst({
    where: eq(mexAccounts.id, dep.mexAccountId),
  });
  if (!mex) {
    await db
      .update(bounceJobs)
      .set({ state: 'failed', lastError: 'mex account not found' })
      .where(eq(bounceJobs.id, job.id));
    return;
  }

  const leaseOwner = `bounce:${job.id}`;
  if (
    !(await claimFinancialAccountLease(db, dep.mexAccountId, 'bounce', leaseOwner, 30 * 60_000))
  ) {
    return;
  }
  try {
    await runWithCorrelation(
      db,
      {
        type: 'deposit_bounce',
        userId: dep.userId,
        entityType: 'bounce_job',
        entityId: job.id,
        summary: `state=${job.state}`,
      },
      async () => {
        switch (job.state) {
          case 'pending':
            await handlePending(db, env, job, dep, mex);
            break;
          case 'withdrawing':
            await handleWithdrawing(db, env, job, dep, mex);
            break;
          case 'awaiting_withdrawal':
            await handleAwaitingWithdrawal(db, env, job, dep, mex);
            break;
          case 'converting':
            await handleConverting(db, env, job, dep, mex);
            break;
          case 'awaiting_conversion':
            await handleAwaitingConversion(db, env, job, dep, mex);
            break;
          default:
            await trace(db, 'warn', 'unexpected_state', `state ${job.state}`);
        }
      },
    );
  } finally {
    await releaseFinancialAccountLease(db, dep.mexAccountId, leaseOwner);
  }
}

async function handlePending(
  db: Database,
  env: WorkerEnv,
  job: BounceJob,
  dep: typeof deposits.$inferSelect,
  mex: typeof mexAccounts.$inferSelect,
) {
  await trace(db, 'info', 'handle_pending', 'resolving routing rule');

  const route = await resolveRoute(db, dep.userId, dep.asset, dep.network);
  if (!route) {
    await markOnHold(db, job, 'no routing rule matches');
    await notify(db, {
      type: 'bounce_on_hold',
      userId: dep.userId,
      text: tpl.bounceOnHold(dep.asset, 'no hay regla de ruteo'),
    });
    return;
  }

  await trace(db, 'info', 'route_resolved', 'wallet selected', {
    walletId: route.wallet.id,
    asset: route.wallet.asset,
    network: route.wallet.network,
  });

  const sameAsset = route.wallet.asset === dep.asset && route.wallet.network === dep.network;
  if (!sameAsset) {
    // Will be handled in phase 5 (conversion)
    await trace(db, 'info', 'needs_conversion', 'transitioning to converting (phase 5)');
    await db
      .update(bounceJobs)
      .set({
        state: 'converting',
        destinationWalletId: route.wallet.id,
        userAmountGross: dep.amount,
      })
      .where(eq(bounceJobs.id, job.id));
    return;
  }

  // Same asset/network: skip conversion, calculate fees and prepare withdraw.
  // Pull the live withdraw fee from MEX so calculateBounce uses the same
  // number that handleWithdrawing will gross up later (avoids fee drift if
  // the seed is out of date).
  const userComm = await getUserCommission(db, dep.userId, dep.asset);
  const platformComm = await getPlatformCommission(db, dep.asset);
  const sameAssetClient = buildMexClient(db, env, mex);
  const netFee = await getLiveNetworkFee(db, sameAssetClient, mex.id, dep.asset, dep.network);
  const minOut = await getMinimumNet(db, dep.asset);

  const calc = calculateBounce({
    grossIn: Number(dep.amount),
    amountAfterConv: Number(dep.amount),
    user: userComm,
    platform: platformComm,
    networkFeeEstimated: netFee,
    minOutput: minOut,
    asset: dep.asset as Asset,
  });

  await trace(db, 'info', 'calculated_amounts', 'commissions computed', {
    grossIn: calc.grossIn,
    userCommission: calc.userCommission,
    platformCommission: calc.platformCommission,
    netFee,
    netToUser: calc.netToUser,
    minOut,
  });

  if (!calc.isAboveMinimum) {
    await db
      .update(bounceJobs)
      .set({
        state: 'failed',
        destinationWalletId: route.wallet.id,
        userAmountGross: dep.amount,
        userAmountAfterConv: dep.amount,
        userCommissionAmount: calc.userCommission.toString(),
        platformCommissionAmount: calc.platformCommission.toString(),
        networkFeeEstimated: netFee.toString(),
        userAmountNet: calc.netToUser.toString(),
        lastError: 'below minimum',
      })
      .where(eq(bounceJobs.id, job.id));
    await db.update(deposits).set({ status: 'below_minimum' }).where(eq(deposits.id, dep.id));
    await notify(db, {
      type: 'bounce_failed',
      userId: dep.userId,
      text: tpl.belowMinimum(dep.asset, dep.amount, minOut),
    });
    return;
  }

  await db
    .update(bounceJobs)
    .set({
      state: 'withdrawing',
      destinationWalletId: route.wallet.id,
      userAmountGross: dep.amount,
      userAmountAfterConv: dep.amount,
      userCommissionAmount: calc.userCommission.toString(),
      platformCommissionAmount: calc.platformCommission.toString(),
      networkFeeEstimated: netFee.toString(),
      userAmountNet: calc.netToUser.toString(),
    })
    .where(eq(bounceJobs.id, job.id));
}

/**
 * IDEMPOTENCY LAYER 3: Two-phase write.
 *
 * 1. Within a transaction, INSERT into withdrawals with the deterministic
 *    withdraw_order_id and mark bounce_job as awaiting_withdrawal.
 * 2. AFTER commit, call MEX. If MEX accepts, store mexWithdrawId.
 * 3. If we crash between steps, reconciliation queries MEX by withdraw_order_id
 *    and either confirms (no retry) or retries safely with the same id.
 *
 * IDEMPOTENCY LAYER 1: withdrawOrderId is deterministic (rb-{jobId}). MEX dedupes.
 */
async function handleWithdrawing(
  db: Database,
  env: WorkerEnv,
  job: BounceJob,
  dep: typeof deposits.$inferSelect,
  mex: typeof mexAccounts.$inferSelect,
) {
  if (!job.destinationWalletId) {
    await markFailed(db, job, 'no destination wallet');
    return;
  }
  const w = await db.query.destinationWallets.findFirst({
    where: (t, { eq }) => eq(t.id, job.destinationWalletId!),
  });
  if (!w) {
    await markFailed(db, job, 'destination wallet missing');
    return;
  }

  // Resolve the MEX network identifier AND the live withdraw fee for this
  // pair before we persist the withdrawal row. We need the fee BEFORE the
  // submission so the gross-up math closes the loop (see below).
  const client = buildMexClient(db, env, mex);
  let mexCoin = w.asset;
  let mexNetwork = w.network;
  let liveFee: number | null = null;
  try {
    const capital = await getCachedCapitalConfig(mex.id, client);
    const resolved = resolveMexNetwork(w.asset, w.network, capital);
    if (!resolved) {
      await markOnHold(db, job, `MEX no expone ${w.asset}/${w.network} en /capital/config/getall`);
      // No row to update yet (withdrawal not persisted); just bail.
      return;
    }
    mexCoin = resolved.coin;
    mexNetwork = resolved.network;
    liveFee = resolved.withdrawFee;
    await trace(
      db,
      'info',
      'mex_network_resolved',
      `${w.asset}/${w.network} -> ${mexCoin}/${mexNetwork}`,
      {
        withdrawFee: liveFee,
      },
    );
  } catch (err) {
    await trace(db, 'warn', 'capital_config_failed_for_withdraw', String(err));
    // Fall back to internal identifiers; MEX will reject if they don't match,
    // and the retry mechanism will pick it up.
  }

  // The fee MEX is about to charge. Prefer live → seeded → hardcoded.
  const feeForGrossUp = liveFee !== null ? liveFee : await getNetworkFee(db, w.asset, w.network);

  // GROSS UP THE SUBMISSION SO THE WALLET RECEIVES `userAmountNet` EXACTLY.
  //
  // MEX deducts `withdrawFee` from the `amount` we submit and routes the
  // remainder on-chain. If we just submitted `userAmountNet`, the wallet
  // would receive `userAmountNet - fee` — but `userAmountNet` already had
  // the fee subtracted upstream in `calculateBounce`, so the user would pay
  // the network fee twice. Adding `feeForGrossUp` cancels MEX's deduction
  // and preserves the contract: `userAmountNet` is what the user gets.
  const userNet = Number(job.userAmountNet ?? '0');
  const submittedAmount = (userNet + feeForGrossUp).toFixed(8);

  // Phase 1: insert withdrawal + flip state, in a tx
  let alreadyExisted = false;
  try {
    await db.transaction(async (tx) => {
      const existing = await tx.query.withdrawals.findFirst({
        where: (t, { eq }) => eq(t.withdrawOrderId, job.withdrawOrderId),
      });
      if (existing) {
        alreadyExisted = true;
      } else {
        await tx.insert(withdrawals).values({
          userId: dep.userId,
          mexAccountId: mex.id,
          type: 'user_payout',
          bounceJobId: job.id,
          asset: w.asset,
          network: w.network,
          address: w.address,
          memo: w.memo,
          // `amount` mirrors what we submit to MEX (= userAmountNet + fee).
          // `wallet_received = amount - fee` is reconstructible, and
          // `bounce_jobs.user_amount_net` continues to mean "what the user gets".
          amount: submittedAmount,
          withdrawOrderId: job.withdrawOrderId,
          status: 'pending',
        });
      }
      await tx
        .update(bounceJobs)
        .set({ state: 'awaiting_withdrawal', updatedAt: new Date() })
        .where(eq(bounceJobs.id, job.id));
    });
  } catch (err) {
    await trace(db, 'error', 'two_phase_write_failed', String(err));
    throw err;
  }

  await trace(db, 'info', 'withdraw_phase1_persisted', 'withdrawal row + state updated', {
    withdrawOrderId: job.withdrawOrderId,
    alreadyExisted,
    userAmountNet: userNet,
    feeForGrossUp,
    submittedAmount,
  });

  try {
    const res = await client.withdraw({
      coin: mexCoin,
      network: mexNetwork,
      address: w.address,
      amount: submittedAmount,
      withdrawOrderId: job.withdrawOrderId,
      memo: w.memo ?? undefined,
    });
    await db
      .update(withdrawals)
      .set({ mexWithdrawId: res.id, status: 'submitted' })
      .where(eq(withdrawals.withdrawOrderId, job.withdrawOrderId));
    await trace(db, 'info', 'withdraw_submitted', 'MEX accepted withdraw', { mexId: res.id });
  } catch (err) {
    if (err instanceof MexBusinessError && err.isDedupHit) {
      await trace(db, 'info', 'withdraw_dedup_hit', 'MEX already has this withdrawOrderId');
      // Reconciliation will fetch true status
      return;
    }
    if (err instanceof MexBusinessError && err.isAssetDisabled) {
      await markOnHold(db, job, `asset/network disabled at MEX: ${err.mexMessage}`);
      await db
        .update(withdrawals)
        .set({ status: 'pending', error: err.mexMessage })
        .where(eq(withdrawals.withdrawOrderId, job.withdrawOrderId));
      return;
    }
    if (err instanceof MexBusinessError && err.isInsufficientBalance) {
      await markOnHold(db, job, `insufficient balance: ${err.mexMessage}`);
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    await trace(db, 'error', 'withdraw_call_failed', reason);
    // Bump retry; transition back to withdrawing for next loop OR fail after MAX
    await retryOrFail(db, job, reason, dep.userId, dep.asset);
  }
}

async function handleAwaitingWithdrawal(
  db: Database,
  env: WorkerEnv,
  job: BounceJob,
  dep: typeof deposits.$inferSelect,
  mex: typeof mexAccounts.$inferSelect,
) {
  const client = buildMexClient(db, env, mex);
  let history: Awaited<ReturnType<typeof client.getWithdrawHistory>> = [];
  try {
    history = await client.getWithdrawHistory({ withdrawOrderId: job.withdrawOrderId, limit: 10 });
  } catch (err) {
    await trace(db, 'warn', 'reconcile_query_failed', String(err));
    return;
  }
  const found = history.find((h) => h.withdrawOrderId === job.withdrawOrderId);
  if (!found) {
    await trace(db, 'debug', 'reconcile_not_found_yet', 'MEX does not show withdraw yet');
    return;
  }
  await applyWithdrawStatus(db, job, dep, found);
}

interface MexWithdrawLike {
  id: string;
  status: number;
  txId?: string | null;
  // MEX serializes fee as either string or number depending on the endpoint.
  transactionFee?: string | number | null;
  network: string;
  withdrawOrderId?: string | null;
}

/**
 * MEX withdraw status mapping (https://mexcdevelop.github.io/apidocs/spot_v3_en/):
 *  1 = email sent / created
 *  2 = cancelled
 *  3 = awaiting approval
 *  4 = approved
 *  5 = wait packaging
 *  6 = wait confirmation
 *  7 = success
 *  8 = failure
 *  10 = manual review
 */
async function applyWithdrawStatus(
  db: Database,
  job: BounceJob,
  dep: typeof deposits.$inferSelect,
  m: MexWithdrawLike,
): Promise<void> {
  if (m.status === 7) {
    // Snapshot the user's cosmetic receipt spread for non-USDT->USDT bounces
    // so the comprobante stays stable if the slider moves later. We only
    // capture when conversion actually occurred (conversionOrderId is set);
    // same-asset bounces have no exchange-rate receipt to render.
    let snapshotSpread: string | null = null;
    if (job.conversionOrderId) {
      const owner = await db.query.users.findFirst({
        where: eq(users.id, dep.userId),
        columns: { receiptSpreadPercent: true },
      });
      snapshotSpread = owner?.receiptSpreadPercent ?? '0';
    }

    await db.transaction(async (tx) => {
      await tx
        .update(withdrawals)
        .set({
          status: 'success',
          mexWithdrawId: m.id,
          onChainTx: m.txId ?? null,
          fee: m.transactionFee != null ? String(m.transactionFee) : null,
          reconciledAt: new Date(),
        })
        .where(eq(withdrawals.withdrawOrderId, job.withdrawOrderId));
      await tx
        .update(bounceJobs)
        .set({
          state: 'done',
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
          // Bounces completed under this build use the v3 receipt formula:
          // - the on-chain payout matches `user_amount_net` (gross-up fix).
          // - the receipt's rate is derived from the actual amount received,
          //   so monto_in × rate === wallet_received exactly.
          //
          // v=2 stays only as historical marker for bounces completed between
          // the v2 ship and the gross-up fix (their receipts are slightly off
          // because the wallet got `userAmountNet - actual_fee`).
          receiptCalcVersion: snapshotSpread !== null ? 3 : null,
          ...(snapshotSpread !== null ? { receiptSpreadPercent: snapshotSpread } : {}),
        })
        .where(eq(bounceJobs.id, job.id));
      await tx.update(deposits).set({ status: 'bounced' }).where(eq(deposits.id, dep.id));
    });
    await notify(db, {
      type: 'bounce_done',
      userId: dep.userId,
      text: tpl.bounceDone(job.userAmountNet ?? '0', dep.asset, m.network, m.txId ?? '(pendiente)'),
    });
    return;
  }

  if (m.status === 2 || m.status === 8) {
    await retryOrFail(db, job, `MEX status=${m.status}`, dep.userId, dep.asset);
    return;
  }

  if (m.status === 10) {
    await markOnHold(db, job, 'MEX manual review');
    return;
  }

  // Other in-flight statuses: keep awaiting_withdrawal
  await trace(db, 'debug', 'withdraw_in_flight', `MEX status=${m.status}`);
}

type RetryState = 'withdrawing' | 'converting';

async function retryOrFail(
  db: Database,
  job: BounceJob,
  reason: string,
  userId: string,
  asset: string,
  nextState: RetryState = 'withdrawing',
) {
  const next = job.retryCount + 1;
  if (next >= MAX_RETRIES) {
    await markFailed(db, job, reason);
    await notify(db, {
      type: 'bounce_failed',
      userId,
      text: tpl.bounceFailed(asset, reason),
    });
    return;
  }
  await db
    .update(bounceJobs)
    .set({
      state: nextState,
      retryCount: next,
      lastError: reason,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(bounceJobs.id, job.id));
}

/**
 * Phase 5: handle conversion when input asset != destination asset.
 * Strategy: market sell for `from -> USDT` cases (most common). For chains where
 * destination is also USDT but on a different network, no conversion needed -
 * MEX handles network as a parameter on withdraw.
 *
 * Idempotency: clientOrderId = conversionClientOrderId(jobId) is deterministic.
 * If we crash after submitting, awaiting_conversion will look up the same id.
 */
async function handleConverting(
  db: Database,
  env: WorkerEnv,
  job: BounceJob,
  dep: typeof deposits.$inferSelect,
  mex: typeof mexAccounts.$inferSelect,
) {
  const w = await db.query.destinationWallets.findFirst({
    where: (t, { eq }) => eq(t.id, job.destinationWalletId!),
  });
  if (!w) {
    await markFailed(db, job, 'destination wallet missing');
    return;
  }

  // If destination asset matches deposit asset, skip conversion (only network differs).
  if (w.asset === dep.asset) {
    await trace(db, 'info', 'skip_conversion_same_asset', 'only network differs');
    await transitionToWithdrawing(db, env, job, dep, mex, w);
    return;
  }

  const symbol = pickSpotSymbol(dep.asset, w.asset);
  if (!symbol) {
    await markOnHold(db, job, `unsupported pair ${dep.asset} -> ${w.asset}`);
    return;
  }

  const client = buildMexClient(db, env, mex);
  const clientOrderId = conversionClientOrderId(job.id);
  const side = symbol.side;

  // MEX rejects spot orders whose quantity does not match the symbol's lot
  // step ("400 quantity scale is invalid"). Pull exchangeInfo for this pair
  // and FLOOR the deposit to the allowed precision before submitting.
  let preparedQuantity: string | undefined;
  let preparedQuoteOrderQty: string | undefined;
  try {
    const info = await getSpotSymbolInfo(client, symbol.symbol);
    if (info) {
      if (side === 'SELL') {
        const decimals = baseQuantityDecimals(info);
        preparedQuantity = truncateToDecimals(dep.amount, decimals);
      } else {
        const decimals = quoteQuantityDecimals(info);
        preparedQuoteOrderQty = truncateToDecimals(dep.amount, decimals);
      }
      const minNotional = symbolMinNotional(info);
      if (minNotional !== null) {
        // Conservative pre-check: for SELL we need quantity*~price >= minNotional.
        // We don't have a price here without an extra call; rely on MEX to
        // surface MIN_NOTIONAL errors and let the platform-min path catch
        // anything systemically too small. Logged for traceability.
        await trace(db, 'debug', 'symbol_min_notional', `min notional ${minNotional}`);
      }
    }
  } catch (err) {
    await trace(db, 'warn', 'exchange_info_failed', String(err));
  }

  // Fall back to the raw deposit amount if exchangeInfo was unavailable,
  // so we keep the previous behaviour rather than blocking the bounce.
  const finalQuantity = preparedQuantity ?? dep.amount;
  const finalQuoteOrderQty = preparedQuoteOrderQty ?? dep.amount;

  if (side === 'SELL' && Number(finalQuantity) <= 0) {
    await markOnHold(
      db,
      job,
      `${dep.asset} amount ${dep.amount} truncates to 0 at symbol precision`,
    );
    return;
  }

  await trace(db, 'info', 'conversion_submit', `market ${side} ${symbol.symbol}`, {
    quantity: side === 'SELL' ? finalQuantity : finalQuoteOrderQty,
    rawDepositAmount: dep.amount,
  });

  // Helper: when MEX confirms it already has an order with our clientOrderId
  // (or when our local response parsing flaked but MEX accepted the order),
  // pull the canonical orderId via queryOrder(origClientOrderId=...) so the
  // awaiting_conversion handler has something to poll.
  const recoverByClientOrderId = async (): Promise<string | null> => {
    try {
      const found = await client.queryOrder({
        symbol: symbol.symbol,
        origClientOrderId: clientOrderId,
      });
      return found.orderId ?? null;
    } catch (lookupErr) {
      await trace(db, 'warn', 'conversion_lookup_failed', String(lookupErr));
      return null;
    }
  };

  try {
    const order = await client.newOrder({
      symbol: symbol.symbol,
      side: side as 'BUY' | 'SELL',
      type: 'MARKET',
      quantity: side === 'SELL' ? finalQuantity : undefined,
      quoteOrderQty: side === 'BUY' ? finalQuoteOrderQty : undefined,
      newClientOrderId: clientOrderId,
    });

    await db
      .update(bounceJobs)
      .set({
        state: 'awaiting_conversion',
        conversionOrderId: order.orderId,
        conversionSymbol: symbol.symbol,
        updatedAt: new Date(),
      })
      .where(eq(bounceJobs.id, job.id));
  } catch (err) {
    if (err instanceof MexBusinessError && err.isDedupHit) {
      await trace(db, 'info', 'conversion_dedup_hit', 'order with same clientOrderId exists');
      // The order already exists at MEX; recover its orderId so we can poll.
      const recoveredId = await recoverByClientOrderId();
      if (!recoveredId) {
        // Don't proceed without an id — that puts us in awaiting_conversion
        // with conversionOrderId=null, which the next handler can only fail.
        await retryOrFail(
          db,
          job,
          'dedup hit but failed to recover orderId',
          dep.userId,
          dep.asset,
          'converting',
        );
        return;
      }
      await db
        .update(bounceJobs)
        .set({
          state: 'awaiting_conversion',
          conversionOrderId: recoveredId,
          conversionSymbol: symbol.symbol,
          updatedAt: new Date(),
        })
        .where(eq(bounceJobs.id, job.id));
      return;
    }
    if (err instanceof MexBusinessError && err.isAssetDisabled) {
      await markOnHold(db, job, `pair disabled: ${err.mexMessage}`);
      return;
    }
    // Last-ditch recovery: some MEX responses (especially for market orders)
    // come back with the order CREATED but a payload we couldn't parse. Look
    // it up by clientOrderId before giving up — this avoids a sterile retry
    // that would just hit dedup.
    const recoveredId = await recoverByClientOrderId();
    if (recoveredId) {
      await trace(db, 'info', 'conversion_recovered_after_parse_error', 'order existed at MEX', {
        orderId: recoveredId,
      });
      await db
        .update(bounceJobs)
        .set({
          state: 'awaiting_conversion',
          conversionOrderId: recoveredId,
          conversionSymbol: symbol.symbol,
          updatedAt: new Date(),
        })
        .where(eq(bounceJobs.id, job.id));
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    await trace(db, 'error', 'conversion_failed', reason);
    // Retry by re-entering the converting state; previously this fell back to
    // 'withdrawing' which then fired a withdraw with amount=0 (cascade bug).
    await retryOrFail(db, job, reason, dep.userId, dep.asset, 'converting');
  }
}

async function handleAwaitingConversion(
  db: Database,
  env: WorkerEnv,
  job: BounceJob,
  dep: typeof deposits.$inferSelect,
  mex: typeof mexAccounts.$inferSelect,
) {
  if (!job.conversionOrderId || !job.conversionSymbol) {
    await markFailed(db, job, 'missing conversion id/symbol');
    return;
  }
  const client = buildMexClient(db, env, mex);
  let order: Awaited<ReturnType<typeof client.queryOrder>>;
  try {
    order = await client.queryOrder({
      symbol: job.conversionSymbol,
      orderId: job.conversionOrderId,
    });
  } catch (err) {
    await trace(db, 'warn', 'conversion_query_failed', String(err));
    return;
  }

  // status / side / executedQty / cummulativeQuoteQty are optional on the
  // schema (because the create-order response omits them), but queryOrder
  // always returns them once the order exists. Treat missing status as
  // "still in flight" rather than crashing.
  const status = order.status ?? '';
  if (status !== 'FILLED' && status !== 'PARTIALLY_FILLED') {
    if (status === 'CANCELED' || status === 'REJECTED' || status === 'EXPIRED') {
      await retryOrFail(
        db,
        job,
        `conversion order status=${status}`,
        dep.userId,
        dep.asset,
        'converting',
      );
      return;
    }
    // Still in flight (NEW, PENDING, '' or anything else MEX might emit).
    await trace(db, 'debug', 'conversion_in_flight', `status=${status || 'unknown'}`);
    return;
  }

  const w = await db.query.destinationWallets.findFirst({
    where: (t, { eq }) => eq(t.id, job.destinationWalletId!),
  });
  if (!w) {
    await markFailed(db, job, 'destination wallet missing');
    return;
  }

  // For market SELL of asset->USDT, executedQty is in BASE asset and
  // cummulativeQuoteQty is in USDT. MEX always populates both on FILLED.
  // Fall back to picking from the symbol when `side` is missing (rare).
  const side: 'BUY' | 'SELL' =
    order.side === 'SELL' || order.side === 'BUY'
      ? order.side
      : job.conversionSymbol.endsWith('USDT')
        ? 'SELL'
        : 'BUY';
  const executedQty = Number(order.executedQty ?? '0');
  const quoteQty = Number(order.cummulativeQuoteQty ?? '0');
  const amountAfterConv = side === 'SELL' ? quoteQty : executedQty;
  if (!Number.isFinite(amountAfterConv) || amountAfterConv <= 0) {
    await trace(
      db,
      'warn',
      'conversion_no_fill_data',
      'order is FILLED but fill quantities are 0',
      {
        executedQty: order.executedQty,
        cummulativeQuoteQty: order.cummulativeQuoteQty,
      },
    );
    return;
  }
  const grossIn = Number(dep.amount);
  // Slippage check: compare expected vs actual
  // Expected (from sell): we don't have a guaranteed reference; use the average
  // implied by the order itself. If avg fill price is way off historic, MEX
  // would reject, so we mostly check sanity.
  const avgPrice =
    side === 'SELL'
      ? amountAfterConv / Math.max(grossIn, 1e-12)
      : grossIn / Math.max(amountAfterConv, 1e-12);
  await trace(db, 'info', 'conversion_filled', 'market order filled', {
    executedQty: order.executedQty,
    cummulativeQuoteQty: order.cummulativeQuoteQty,
    avgPrice,
  });

  // Now compute commissions on the after-conversion amount in TARGET asset.
  // Use the live MEX fee so the gross-up at withdraw time matches what we
  // budgeted for; otherwise small fee changes leak into the wallet amount.
  const userComm = await getUserCommission(db, dep.userId, w.asset);
  const platformComm = await getPlatformCommission(db, w.asset);
  const netFee = await getLiveNetworkFee(db, client, mex.id, w.asset, w.network);
  const minOut = await getMinimumNet(db, w.asset);

  const calc = calculateBounce({
    grossIn,
    amountAfterConv,
    user: userComm,
    platform: platformComm,
    networkFeeEstimated: netFee,
    minOutput: minOut,
    asset: w.asset as Asset,
  });

  if (!calc.isAboveMinimum) {
    await db
      .update(bounceJobs)
      .set({
        state: 'failed',
        userAmountAfterConv: amountAfterConv.toString(),
        userCommissionAmount: calc.userCommission.toString(),
        platformCommissionAmount: calc.platformCommission.toString(),
        networkFeeEstimated: netFee.toString(),
        userAmountNet: calc.netToUser.toString(),
        lastError: 'below minimum after conversion',
      })
      .where(eq(bounceJobs.id, job.id));
    await db.update(deposits).set({ status: 'below_minimum' }).where(eq(deposits.id, dep.id));
    await notify(db, {
      type: 'bounce_failed',
      userId: dep.userId,
      text: tpl.belowMinimum(w.asset, amountAfterConv.toString(), minOut),
    });
    return;
  }

  await db
    .update(bounceJobs)
    .set({
      state: 'withdrawing',
      userAmountAfterConv: amountAfterConv.toString(),
      userCommissionAmount: calc.userCommission.toString(),
      platformCommissionAmount: calc.platformCommission.toString(),
      networkFeeEstimated: netFee.toString(),
      userAmountNet: calc.netToUser.toString(),
      updatedAt: new Date(),
    })
    .where(eq(bounceJobs.id, job.id));
}

async function transitionToWithdrawing(
  db: Database,
  env: WorkerEnv,
  job: BounceJob,
  dep: typeof deposits.$inferSelect,
  mex: typeof mexAccounts.$inferSelect,
  w: { asset: string; network: string },
) {
  const userComm = await getUserCommission(db, dep.userId, dep.asset);
  const platformComm = await getPlatformCommission(db, dep.asset);
  const client = buildMexClient(db, env, mex);
  const netFee = await getLiveNetworkFee(db, client, mex.id, w.asset, w.network);
  const minOut = await getMinimumNet(db, w.asset);
  const calc = calculateBounce({
    grossIn: Number(dep.amount),
    amountAfterConv: Number(dep.amount),
    user: userComm,
    platform: platformComm,
    networkFeeEstimated: netFee,
    minOutput: minOut,
    asset: dep.asset as Asset,
  });
  if (!calc.isAboveMinimum) {
    await markFailed(db, job, 'below minimum');
    await db.update(deposits).set({ status: 'below_minimum' }).where(eq(deposits.id, dep.id));
    return;
  }
  await db
    .update(bounceJobs)
    .set({
      state: 'withdrawing',
      userAmountAfterConv: dep.amount,
      userCommissionAmount: calc.userCommission.toString(),
      platformCommissionAmount: calc.platformCommission.toString(),
      networkFeeEstimated: netFee.toString(),
      userAmountNet: calc.netToUser.toString(),
      updatedAt: new Date(),
    })
    .where(eq(bounceJobs.id, job.id));
}

interface SpotSymbolPick {
  symbol: string;
  side: 'BUY' | 'SELL';
}

function pickSpotSymbol(from: string, to: string): SpotSymbolPick | null {
  if (from === to) return null;
  if (to === 'USDT') return { symbol: `${from}USDT`, side: 'SELL' };
  if (from === 'USDT') return { symbol: `${to}USDT`, side: 'BUY' };
  // Cross asset (BTC -> ETH): not supported MVP
  return null;
}

async function markFailed(db: Database, job: BounceJob, reason: string) {
  await db
    .update(bounceJobs)
    .set({ state: 'failed', lastError: reason, updatedAt: new Date() })
    .where(eq(bounceJobs.id, job.id));
  await db.update(deposits).set({ status: 'failed' }).where(eq(deposits.id, job.depositId));
  await trace(db, 'error', 'job_failed', reason);
}

async function markOnHold(db: Database, job: BounceJob, reason: string) {
  await db
    .update(bounceJobs)
    .set({ state: 'on_hold', onHoldReason: reason, updatedAt: new Date() })
    .where(eq(bounceJobs.id, job.id));
  await db.update(deposits).set({ status: 'on_hold' }).where(eq(deposits.id, job.depositId));
  await trace(db, 'warn', 'job_on_hold', reason);
}
