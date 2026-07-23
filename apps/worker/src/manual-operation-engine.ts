import type { WorkerEnv } from '@rb/config';
import type { Database, ManualOperation } from '@rb/db';
import { manualOperationDeposits, manualOperations, mexAccounts, withdrawals } from '@rb/db';
import {
  candidateSpotPairs,
  manualOperationConversionOrderId,
  manualOperationPayoutOrderId,
  manualOperationRefundOrderId,
} from '@rb/domain';
import { MexBusinessError, type MexTrade, fetchBookTickers } from '@rb/mex-client';
import Decimal from 'decimal.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { runWithCorrelation } from './correlation';
import { getPlatformCommission, getUserCommission } from './lib/commissions';
import {
  getCachedCapitalConfig,
  resolveMexNetwork,
  resolveSnapshottedMexNetwork,
} from './lib/mex-network-resolver';
import {
  baseQuantityDecimals,
  getSpotSymbolInfo,
  quoteQuantityDecimals,
  truncateToDecimals,
} from './lib/spot-precision';
import { logger } from './logger';
import { isMaintenanceActive } from './maintenance';
import { buildMexClient } from './mex-account';
import { notify, tpl } from './notifier';

const POLL_MS = 5_000;
const LEASE_TIMEOUT_MS = 30 * 60_000;
const PROCESSABLE_STATES = [
  'converting',
  'awaiting_conversion',
  'withdrawing',
  'refunding',
] as const;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

export function startManualOperationEngine({ db, env }: Ctx): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      if (await isMaintenanceActive(db)) return;
      const operations = await leaseOperations(db, env.WORKER_ID, 1);
      for (const op of operations) {
        try {
          await runWithCorrelation(
            db,
            {
              type: 'manual_operation',
              userId: op.userId,
              entityType: 'manual_operation',
              entityId: op.id,
              summary: `state=${op.state}`,
            },
            async () => processOperation(db, env, op),
          );
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          logger.error(
            { err, manualOperationId: op.id, state: op.state },
            'manual operation failed',
          );
          await putOnHold(db, op, reason, op.state);
        } finally {
          await db
            .update(manualOperations)
            .set({ lockedAt: null, lockedBy: null })
            .where(
              and(eq(manualOperations.id, op.id), eq(manualOperations.lockedBy, env.WORKER_ID)),
            );
        }
      }
    } catch (err) {
      logger.error({ err }, 'manual-operation engine iteration failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };
  timer = setTimeout(tick, 4_000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function leaseOperations(
  db: Database,
  workerId: string,
  limit: number,
): Promise<ManualOperation[]> {
  const cutoff = new Date(Date.now() - LEASE_TIMEOUT_MS);
  const result = await db.execute<{ id: string }>(sql`
    WITH candidates AS (
      SELECT id
      FROM manual_operations
      WHERE state = ANY(${sql.raw(`ARRAY['${PROCESSABLE_STATES.join("','")}']::text[]`)})
        AND (locked_at IS NULL OR locked_at < ${cutoff.toISOString()}::timestamptz)
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE manual_operations
    SET locked_by = ${workerId}, locked_at = now(), version = version + 1
    WHERE id IN (SELECT id FROM candidates)
    RETURNING id
  `);
  const ids = (result as unknown as Array<{ id: string }>).map((row) => row.id);
  if (ids.length === 0) return [];
  return db.select().from(manualOperations).where(inArray(manualOperations.id, ids));
}

async function processOperation(db: Database, env: WorkerEnv, op: ManualOperation): Promise<void> {
  const mex = await db.query.mexAccounts.findFirst({
    where: and(eq(mexAccounts.id, op.mexAccountId), eq(mexAccounts.status, 'active')),
  });
  if (!mex) throw new Error('active MEX account not found');

  if (op.state === 'converting' || op.state === 'withdrawing') {
    await notify(db, {
      type: 'manual_op_processing',
      userId: op.userId,
      text: tpl.manualProcessing(),
      dedupeKey: `manual-op:${op.id}:processing`,
    });
  }

  switch (op.state) {
    case 'converting':
      await handleConverting(db, env, op, mex);
      return;
    case 'awaiting_conversion':
      await handleAwaitingConversion(db, env, op, mex);
      return;
    case 'withdrawing':
      await handlePayout(db, env, op, mex);
      return;
    case 'refunding':
      await handleRefund(db, env, op, mex);
      return;
  }
}

function validateExecutionAmounts(op: ManualOperation): {
  execute: Decimal;
  received: Decimal;
  surplus: Decimal;
} {
  const received = new Decimal(op.receivedAmount ?? '0');
  const execute = new Decimal(op.amountToExecute ?? op.nominalAmount);
  if (!received.isFinite() || !execute.isFinite() || execute.lte(0) || execute.gt(received)) {
    throw new Error('invalid amount_to_execute/received_amount');
  }
  return { execute, received, surplus: received.sub(execute) };
}

async function handleConverting(
  db: Database,
  env: WorkerEnv,
  op: ManualOperation,
  mex: typeof mexAccounts.$inferSelect,
): Promise<void> {
  const { execute, surplus } = validateExecutionAmounts(op);
  if (op.fromAsset === op.toAsset) {
    await db
      .update(manualOperations)
      .set({
        state: 'withdrawing',
        convertedAmountGross: execute.toFixed(8),
        surplusAmount: surplus.toFixed(8),
        surplusAsset: op.fromAsset,
        updatedAt: new Date(),
      })
      .where(and(eq(manualOperations.id, op.id), eq(manualOperations.state, 'converting')));
    return;
  }

  const client = buildMexClient(db, env, mex);
  let resolved:
    | {
        symbol: string;
        side: 'BUY' | 'SELL';
        info: NonNullable<Awaited<ReturnType<typeof getSpotSymbolInfo>>>;
      }
    | undefined;
  if (op.spotSymbol && op.spotSide) {
    const info = await getSpotSymbolInfo(client, op.spotSymbol);
    if (info && !['BREAK', 'DISABLED', 'OFFLINE'].includes(info.status?.toUpperCase() ?? '')) {
      resolved = { symbol: op.spotSymbol, side: op.spotSide as 'BUY' | 'SELL', info };
    }
  } else {
    for (const candidate of candidateSpotPairs(op.fromAsset, op.toAsset)) {
      const info = await getSpotSymbolInfo(client, candidate.symbol);
      if (info && !['BREAK', 'DISABLED', 'OFFLINE'].includes(info.status?.toUpperCase() ?? '')) {
        resolved = { symbol: candidate.symbol, side: candidate.side, info };
        break;
      }
    }
  }
  if (!resolved) throw new Error(`no active direct MEX pair for ${op.fromAsset}/${op.toAsset}`);

  if (op.confirmationQuote && op.confirmationQuoteAt) {
    if (Date.now() - op.confirmationQuoteAt.getTime() > 30_000) {
      throw new Error('confirmation quote is stale');
    }
    const [ticker] = await fetchBookTickers([resolved.symbol], { timeoutMs: 4_000 });
    if (!ticker) throw new Error('current quote unavailable');
    const live = new Decimal(resolved.side === 'SELL' ? ticker.bid : ticker.ask);
    const confirmed = new Decimal(op.confirmationQuote);
    const deviationBps = live.sub(confirmed).abs().div(confirmed).mul(10_000);
    if (deviationBps.gt(op.maxSlippageBps)) {
      throw new Error(`slippage ${deviationBps.toFixed(0)}bps exceeds ${op.maxSlippageBps}bps`);
    }
  }

  const amount =
    resolved.side === 'SELL'
      ? truncateToDecimals(execute.toFixed(), baseQuantityDecimals(resolved.info))
      : truncateToDecimals(execute.toFixed(), quoteQuantityDecimals(resolved.info));
  if (new Decimal(amount).lte(0)) throw new Error('conversion amount truncates to zero');

  const precisionDust = execute.sub(amount);
  const totalSurplus = surplus.add(precisionDust);
  const clientOrderId = manualOperationConversionOrderId(op.id);
  await db
    .update(manualOperations)
    .set({
      spotSymbol: resolved.symbol,
      spotSide: resolved.side,
      surplusAmount: totalSurplus.toFixed(8),
      surplusAsset: op.fromAsset,
      updatedAt: new Date(),
    })
    .where(and(eq(manualOperations.id, op.id), eq(manualOperations.state, 'converting')));

  const recover = async () => {
    try {
      return await client.queryOrder({
        symbol: resolved!.symbol,
        origClientOrderId: clientOrderId,
      });
    } catch {
      return null;
    }
  };

  try {
    const order = await client.newOrder({
      symbol: resolved.symbol,
      side: resolved.side,
      type: 'MARKET',
      quantity: resolved.side === 'SELL' ? amount : undefined,
      quoteOrderQty: resolved.side === 'BUY' ? amount : undefined,
      newClientOrderId: clientOrderId,
    });
    await persistSubmittedConversion(db, op.id, order.orderId);
  } catch (err) {
    const recovered = await recover();
    if (recovered) {
      await persistSubmittedConversion(db, op.id, recovered.orderId);
      return;
    }
    if (err instanceof MexBusinessError && err.isDedupHit) {
      throw new Error('conversion dedup hit but order recovery failed');
    }
    throw err;
  }
}

async function persistSubmittedConversion(
  db: Database,
  operationId: string,
  mexOrderId: string,
): Promise<void> {
  await db
    .update(manualOperations)
    .set({
      state: 'awaiting_conversion',
      conversionOrderId: mexOrderId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(manualOperations.id, operationId),
        inArray(manualOperations.state, ['converting', 'awaiting_conversion']),
      ),
    );
}

async function handleAwaitingConversion(
  db: Database,
  env: WorkerEnv,
  op: ManualOperation,
  mex: typeof mexAccounts.$inferSelect,
): Promise<void> {
  if (!op.spotSymbol || !op.spotSide || !op.conversionOrderId) {
    throw new Error('conversion identifiers missing');
  }
  const client = buildMexClient(db, env, mex);
  const order = await client.queryOrder({
    symbol: op.spotSymbol,
    orderId: op.conversionOrderId,
  });
  const status = order.status ?? '';
  if (status === 'PARTIALLY_FILLED' || status === 'NEW' || status === 'PENDING' || !status) return;
  if (status !== 'FILLED') throw new Error(`conversion order status=${status}`);

  const trades: MexTrade[] = [];
  let fromId: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const batch = await client.getMyTrades({
      symbol: op.spotSymbol,
      orderId: op.conversionOrderId,
      limit: 1000,
      fromId,
    });
    const orderTrades = batch.filter((trade) => trade.orderId === op.conversionOrderId);
    trades.push(...orderTrades);
    if (batch.length < 1000) break;
    const lastId = batch.at(-1)?.id;
    if (!lastId || !/^\d+$/.test(lastId)) {
      throw new Error('cannot paginate conversion trade records');
    }
    fromId = new Decimal(lastId).add(1).toFixed(0);
    if (page === 19) throw new Error('conversion trade pagination limit exceeded');
  }
  if (trades.length === 0) return;
  const commissionAssets = [...new Set(trades.map((trade) => trade.commissionAsset))];
  if (commissionAssets.length > 1) {
    throw new Error(`conversion commissions use multiple assets: ${commissionAssets.join(',')}`);
  }
  const commissionAsset = commissionAssets[0] ?? null;
  const commission = trades.reduce((sum, trade) => sum.add(trade.commission), new Decimal(0));
  const gross =
    op.spotSide === 'SELL'
      ? new Decimal(order.cummulativeQuoteQty ?? '0')
      : new Decimal(order.executedQty ?? '0');
  if (gross.lte(0)) throw new Error('FILLED conversion has zero output');
  const outputAfterMexCommission = commissionAsset === op.toAsset ? gross.sub(commission) : gross;
  if (outputAfterMexCommission.lte(0)) throw new Error('MEX commission consumed conversion output');

  const executed = new Decimal(order.executedQty ?? '0');
  const quote = new Decimal(order.cummulativeQuoteQty ?? '0');
  if (executed.lte(0) || quote.lte(0)) throw new Error('FILLED conversion has invalid fill totals');
  const tradeExecuted = trades.reduce((sum, trade) => sum.add(trade.qty), new Decimal(0));
  const tradeQuote = trades.reduce((sum, trade) => sum.add(trade.quoteQty), new Decimal(0));
  if (!tradeExecuted.eq(executed) || !tradeQuote.eq(quote)) {
    return;
  }
  const average = quote.div(executed);

  await db
    .update(manualOperations)
    .set({
      state: 'withdrawing',
      convertedAmountGross: outputAfterMexCommission.toFixed(8),
      averageFillPrice: average.toFixed(12),
      mexTradingCommission: commission.toFixed(8),
      mexCommissionAsset: commissionAsset,
      updatedAt: new Date(),
    })
    .where(and(eq(manualOperations.id, op.id), eq(manualOperations.state, 'awaiting_conversion')));
}

async function outputCalculation(
  db: Database,
  op: ManualOperation,
  liveFee: number,
  withdrawIntegerMultiple?: Decimal.Value | null,
): Promise<{
  gross: Decimal;
  userCommission: Decimal;
  platformCommission: Decimal;
  payoutSubmitted: Decimal;
  payoutPrecisionDust: Decimal;
  walletOutput: Decimal;
}> {
  const gross = new Decimal(op.convertedAmountGross ?? op.amountToExecute ?? op.nominalAmount);
  const user = await getUserCommission(db, op.userId, op.toAsset);
  const platform = await getPlatformCommission(db, op.toAsset);
  const userCommission = gross.mul(user.percent).add(user.fixed).toDecimalPlaces(8);
  const platformCommission = gross.mul(platform.percent).add(platform.fixed).toDecimalPlaces(8);
  const payoutAvailable = gross.sub(userCommission).sub(platformCommission);
  const { submitted: payoutSubmitted, dust: payoutPrecisionDust } = calculatePayoutSubmission(
    payoutAvailable,
    withdrawIntegerMultiple,
  );
  const walletOutput = payoutSubmitted.sub(liveFee);
  if (payoutSubmitted.lte(0) || walletOutput.lte(0)) {
    throw new Error('commissions and payout fee consume output');
  }
  return {
    gross,
    userCommission,
    platformCommission,
    payoutSubmitted,
    payoutPrecisionDust,
    walletOutput,
  };
}

export function calculatePayoutSubmission(
  available: Decimal.Value,
  integerMultiple?: Decimal.Value | null,
): { submitted: Decimal; dust: Decimal } {
  const amount = new Decimal(available);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new Error('payout amount must be positive');
  }
  let submitted = amount.toDecimalPlaces(8, Decimal.ROUND_DOWN);
  const step = withdrawalAmountStep(integerMultiple);
  if (step) {
    submitted = amount.div(step).floor().mul(step).toDecimalPlaces(8, Decimal.ROUND_DOWN);
  }
  if (submitted.lte(0)) throw new Error('payout amount truncates to zero');
  return { submitted, dust: amount.sub(submitted) };
}

export function withdrawalAmountStep(integerMultiple?: Decimal.Value | null): Decimal | null {
  if (integerMultiple === null || integerMultiple === undefined) return null;
  const raw = String(integerMultiple).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const decimalPlaces = Number(raw);
    if (Number.isInteger(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 30) {
      return new Decimal(10).pow(-decimalPlaces);
    }
  }
  const step = new Decimal(raw);
  if (!step.isFinite() || step.lte(0)) {
    throw new Error('invalid withdrawal amount precision');
  }
  return step;
}

async function handlePayout(
  db: Database,
  env: WorkerEnv,
  op: ManualOperation,
  mex: typeof mexAccounts.$inferSelect,
): Promise<void> {
  validateExecutionAmounts(op);
  const client = buildMexClient(db, env, mex);
  const capital = await getCachedCapitalConfig(mex.id, client);
  const resolved =
    op.payoutMexCoin && op.payoutMexNetwork
      ? resolveSnapshottedMexNetwork(op.payoutMexCoin, op.payoutMexNetwork, capital)
      : resolveMexNetwork(op.toAsset, op.toNetwork, capital);
  if (!resolved || resolved.withdrawFee === null || resolved.withdrawMin === null) {
    throw new Error(`live payout constraints unavailable for ${op.toAsset}/${op.toNetwork}`);
  }
  const calc = await outputCalculation(
    db,
    op,
    resolved.withdrawFee,
    resolved.withdrawIntegerMultiple,
  );
  if (calc.payoutSubmitted.lt(resolved.withdrawMin)) {
    throw new Error(`payout below live MEX minimum ${resolved.withdrawMin}`);
  }
  const withdrawOrderId = manualOperationPayoutOrderId(op.id, op.retryCount);

  await db.transaction(async (tx) => {
    await tx
      .insert(withdrawals)
      .values({
        userId: op.userId,
        mexAccountId: op.mexAccountId,
        manualOperationId: op.id,
        type: 'manual_operation_payout',
        asset: op.toAsset,
        network: op.toNetwork,
        address: op.payoutAddress,
        memo: op.payoutMemo,
        amount: calc.payoutSubmitted.toFixed(8),
        fee: String(resolved.withdrawFee),
        withdrawOrderId,
        status: 'pending',
      })
      .onConflictDoNothing();
    await tx
      .update(manualOperations)
      .set({
        state: 'awaiting_withdrawal',
        convertedAmountGross: calc.gross.toFixed(8),
        userCommissionAmount: calc.userCommission.toFixed(8),
        platformCommissionAmount: calc.platformCommission.toFixed(8),
        payoutPrecisionDust: calc.payoutPrecisionDust.toFixed(8),
        payoutNetworkFee: String(resolved.withdrawFee),
        executedOutput: calc.walletOutput.toFixed(8),
        executedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(manualOperations.id, op.id), eq(manualOperations.state, 'withdrawing')));
  });

  try {
    const response = await client.withdraw({
      coin: resolved.coin,
      network: resolved.network,
      address: op.payoutAddress,
      memo: op.payoutMemo ?? undefined,
      amount: calc.payoutSubmitted.toFixed(8),
      withdrawOrderId,
      remark: 'manual_operation_payout',
    });
    await db
      .update(withdrawals)
      .set({ status: 'submitted', mexWithdrawId: response.id, updatedAt: new Date() })
      .where(eq(withdrawals.withdrawOrderId, withdrawOrderId));
  } catch (err) {
    if (err instanceof MexBusinessError && err.isDedupHit) return;
    if (err instanceof MexBusinessError) {
      await db
        .update(withdrawals)
        .set({ status: 'failed', error: err.message, updatedAt: new Date() })
        .where(eq(withdrawals.withdrawOrderId, withdrawOrderId));
      throw err;
    }
    await db
      .update(withdrawals)
      .set({
        error: `submission result unknown: ${err instanceof Error ? err.message : String(err)}`,
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.withdrawOrderId, withdrawOrderId));
  }
}

export function calculateRefundSubmission(
  surplus: Decimal.Value,
  withdrawMin: Decimal.Value,
  withdrawFee: Decimal.Value,
  integerMultiple?: Decimal.Value | null,
): string | null {
  const amount = new Decimal(surplus);
  const minimum = new Decimal(withdrawMin);
  const fee = new Decimal(withdrawFee);
  if (!amount.isFinite() || amount.lte(minimum.add(fee))) return null;
  const step = withdrawalAmountStep(integerMultiple);
  if (step) {
    const floored = amount.div(step).floor().mul(step);
    return floored.gt(minimum.add(fee)) ? floored.toFixed(8) : null;
  }
  return amount.toFixed(8);
}

async function handleRefund(
  db: Database,
  env: WorkerEnv,
  op: ManualOperation,
  mex: typeof mexAccounts.$inferSelect,
): Promise<void> {
  const unresolved = await countUnresolvedCandidates(db, op.id);
  if (!op.refundWalletId || !op.refundAddress || new Decimal(op.surplusAmount ?? '0').lte(0)) {
    await finishOperation(db, op, unresolved);
    return;
  }

  const client = buildMexClient(db, env, mex);
  const capital = await getCachedCapitalConfig(mex.id, client);
  const resolved = resolveMexNetwork(op.fromAsset, op.fromNetwork, capital);
  if (!resolved || resolved.withdrawFee === null || resolved.withdrawMin === null) {
    throw new Error(`live refund constraints unavailable for ${op.fromAsset}/${op.fromNetwork}`);
  }
  const submitted = calculateRefundSubmission(
    op.surplusAmount ?? '0',
    resolved.withdrawMin,
    resolved.withdrawFee,
    resolved.withdrawIntegerMultiple,
  );
  if (!submitted) {
    await finishOperation(db, op, unresolved);
    return;
  }
  const withdrawOrderId = manualOperationRefundOrderId(op.id, op.retryCount);
  await db.transaction(async (tx) => {
    await tx
      .insert(withdrawals)
      .values({
        userId: op.userId,
        mexAccountId: op.mexAccountId,
        manualOperationId: op.id,
        type: 'manual_operation_refund',
        asset: op.fromAsset,
        network: op.fromNetwork,
        address: op.refundAddress!,
        memo: op.refundMemo,
        amount: submitted,
        fee: String(resolved.withdrawFee),
        withdrawOrderId,
        status: 'pending',
      })
      .onConflictDoNothing();
    await tx
      .update(manualOperations)
      .set({
        state: 'awaiting_refund',
        refundNetworkFee: String(resolved.withdrawFee),
        updatedAt: new Date(),
      })
      .where(and(eq(manualOperations.id, op.id), eq(manualOperations.state, 'refunding')));
  });

  try {
    const response = await client.withdraw({
      coin: resolved.coin,
      network: resolved.network,
      address: op.refundAddress,
      memo: op.refundMemo ?? undefined,
      amount: submitted,
      withdrawOrderId,
      remark: 'manual_operation_refund',
    });
    await db
      .update(withdrawals)
      .set({ status: 'submitted', mexWithdrawId: response.id, updatedAt: new Date() })
      .where(eq(withdrawals.withdrawOrderId, withdrawOrderId));
  } catch (err) {
    if (err instanceof MexBusinessError && err.isDedupHit) return;
    if (err instanceof MexBusinessError) {
      await db
        .update(withdrawals)
        .set({ status: 'failed', error: err.message, updatedAt: new Date() })
        .where(eq(withdrawals.withdrawOrderId, withdrawOrderId));
      throw err;
    }
    await db
      .update(withdrawals)
      .set({
        error: `submission result unknown: ${err instanceof Error ? err.message : String(err)}`,
        updatedAt: new Date(),
      })
      .where(eq(withdrawals.withdrawOrderId, withdrawOrderId));
  }
}

async function countUnresolvedCandidates(db: Database, operationId: string): Promise<number> {
  const rows = await db
    .select({ id: manualOperationDeposits.id })
    .from(manualOperationDeposits)
    .where(
      and(
        eq(manualOperationDeposits.manualOperationId, operationId),
        eq(manualOperationDeposits.status, 'candidate'),
      ),
    );
  return rows.length;
}

async function finishOperation(
  db: Database,
  op: ManualOperation,
  unresolvedCandidates: number,
): Promise<void> {
  const state =
    unresolvedCandidates > 0
      ? 'pending_candidate_resolution'
      : op.terminalState === 'cancelled'
        ? 'cancelled'
        : 'done';
  await db
    .update(manualOperations)
    .set({
      state,
      completedAt: state === 'done' || state === 'cancelled' ? new Date() : null,
      cancelledAt: state === 'cancelled' ? new Date() : op.cancelledAt,
      updatedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    })
    .where(
      and(
        eq(manualOperations.id, op.id),
        inArray(manualOperations.state, [
          'converting',
          'awaiting_conversion',
          'withdrawing',
          'awaiting_withdrawal',
          'refunding',
          'awaiting_refund',
        ]),
      ),
    );
  await notify(db, {
    type:
      state === 'done'
        ? 'manual_op_done'
        : state === 'cancelled'
          ? 'manual_op_cancelled'
          : 'manual_op_candidate_resolution',
    userId: op.userId,
    text:
      state === 'done'
        ? tpl.manualDone(op.executedOutput ?? '0', op.toAsset)
        : state === 'cancelled'
          ? tpl.manualCancelled()
          : tpl.manualCandidateResolution(),
    dedupeKey: `manual-op:${op.id}:${state}`,
  });
}

async function putOnHold(
  db: Database,
  op: ManualOperation,
  reason: string,
  resumeState: string,
): Promise<void> {
  const held = await db
    .update(manualOperations)
    .set({
      state: 'on_hold',
      resumeState,
      lastError: reason,
      retryCount: op.retryCount + 1,
      updatedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    })
    .where(
      and(
        eq(manualOperations.id, op.id),
        inArray(manualOperations.state, [
          'converting',
          'awaiting_conversion',
          'withdrawing',
          'awaiting_withdrawal',
          'refunding',
          'awaiting_refund',
        ]),
      ),
    )
    .returning({ id: manualOperations.id });
  if (held.length === 0) return;
  await notify(db, {
    type: 'manual_op_on_hold',
    userId: op.userId,
    text: tpl.manualOnHold(reason),
    dedupeKey: `manual-op:${op.id}:on-hold:${op.version}`,
  });
}
