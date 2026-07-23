'use server';

import { randomInt } from 'node:crypto';
import {
  type RevalidatedAdmin,
  requireAdminTotp,
  requireRevalidatedAdmin,
} from '@/lib/admin-security';
import { db } from '@/lib/db';
import { buildWebMexClient } from '@/lib/mex-account-client';
import {
  auditLog,
  bounceJobs,
  deposits,
  destinationWallets,
  financialAccountLocks,
  getPlatformCommission,
  getUserCommission,
  manualOperationDeposits,
  manualOperations,
  mexAccounts,
  mexDepositAddresses,
  systemSettings,
  telegramMessages,
  users,
  withdrawals,
} from '@rb/db';
import {
  ASSETS,
  type Asset,
  BOUNCE_JOB_STATES,
  MANUAL_OPERATION_TTL_MS,
  SUPPORTED_PAIRS,
  WITHDRAWAL_STATUSES,
  buildExpectedDepositAmount,
  calculateManualSurplus,
  candidateSpotPairs,
  userPayoutOrderId,
  validateManualNominal,
} from '@rb/domain';
import {
  MexClient,
  buildMexOutputCatalog,
  fetchBookTickers,
  selectMexOutputNetwork,
} from '@rb/mex-client';
import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const ACTIVE_MANUAL_STATES = [
  'awaiting_deposit',
  'awaiting_deposit_confirmation',
  'pending_user_confirm',
  'pending_admin_confirm',
  'pending_candidate_resolution',
  'converting',
  'awaiting_conversion',
  'withdrawing',
  'awaiting_withdrawal',
  'refunding',
  'awaiting_refund',
  'on_hold',
] as const;
const PRE_EXTERNAL_STATES = [
  'awaiting_deposit',
  'awaiting_deposit_confirmation',
  'pending_user_confirm',
  'pending_admin_confirm',
] as const;
const LIVE_BOUNCE_STATES = BOUNCE_JOB_STATES.filter((state) => !['done', 'failed'].includes(state));
const LIVE_WITHDRAWAL_STATES = WITHDRAWAL_STATUSES.filter((state) =>
  ['pending', 'submitted', 'processing'].includes(state),
);

export interface ManualActionState {
  ok: boolean;
  error?: string;
  operationId?: string;
}

const createSchema = z.object({
  fromAsset: z.enum(ASSETS),
  fromNetwork: z.string().min(1),
  toAsset: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,20}$/),
  toNetwork: z.string().trim().min(1).max(100),
  nominalAmount: z.string().min(1),
  payoutAddress: z.string().trim().min(8).max(200).regex(/^\S+$/),
  payoutMemo: z.string().trim().max(200).optional(),
  payoutMexCoin: z.string().trim().min(1).max(100),
  payoutMexNetwork: z.string().trim().min(1).max(100),
  payoutConfirmed: z.literal('on'),
  refundWalletId: z.union([z.string().uuid(), z.literal('')]).optional(),
  internalNotes: z.string().max(2000).optional(),
});

type CreateInput = z.infer<typeof createSchema>;
type Quote = { symbol: string | null; side: 'BUY' | 'SELL' | null; price: number };

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function resultError(error: unknown): ManualActionState {
  return { ok: false, error: error instanceof Error ? error.message : 'Error inesperado' };
}

function isTradableStatus(status: string | undefined): boolean {
  return status !== undefined && ['1', 'TRADING', 'ENABLED'].includes(status.toUpperCase());
}

function matchesMexPattern(value: string, pattern: string | null): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    throw new Error('MEX informó una regla de dirección inválida para esta red');
  }
}

async function resolveFreshQuote(from: string, to: string): Promise<Quote> {
  if (from === to) return { symbol: null, side: null, price: 1 };
  const client = new MexClient({ apiKey: '', apiSecret: '' });
  for (const candidate of candidateSpotPairs(from, to)) {
    const info = await client.getSymbolInfo(candidate.symbol);
    if (!info || info.symbol !== candidate.symbol || !isTradableStatus(info.status)) continue;
    const [ticker] = await fetchBookTickers([candidate.symbol], { timeoutMs: 4_000 });
    if (!ticker || ticker.symbol !== candidate.symbol) continue;
    return {
      symbol: candidate.symbol,
      side: candidate.side,
      price: candidate.side === 'SELL' ? ticker.bid : ticker.ask,
    };
  }
  throw new Error(`No hay un mercado MEX directo habilitado para ${from}/${to}`);
}

async function estimateOutput(
  userId: string,
  nominal: string,
  toAsset: string,
  networkFee: number,
  quote: Quote,
): Promise<string> {
  const amount = Number(nominal);
  const gross =
    quote.side === 'SELL'
      ? amount * quote.price
      : quote.side === 'BUY'
        ? amount / quote.price
        : amount;
  const [userCommission, platformCommission] = await Promise.all([
    getUserCommission(db, userId, toAsset),
    getPlatformCommission(db, toAsset),
  ]);
  const net =
    gross -
    (gross * userCommission.percent + userCommission.fixed) -
    (gross * platformCommission.percent + platformCommission.fixed) -
    networkFee;
  if (!Number.isFinite(net) || net <= 0) throw new Error('Comisiones y fee consumen el estimado');
  return net.toFixed(8);
}

async function assertNoFinancialWork(mexAccountId: string): Promise<void> {
  const [manual, bounce, withdrawal] = await Promise.all([
    db
      .select({ id: manualOperations.id })
      .from(manualOperations)
      .where(
        and(
          eq(manualOperations.mexAccountId, mexAccountId),
          inArray(manualOperations.state, [...ACTIVE_MANUAL_STATES]),
        ),
      )
      .limit(1),
    db
      .select({ id: bounceJobs.id })
      .from(bounceJobs)
      .innerJoin(deposits, eq(deposits.id, bounceJobs.depositId))
      .where(
        and(eq(deposits.mexAccountId, mexAccountId), inArray(bounceJobs.state, LIVE_BOUNCE_STATES)),
      )
      .limit(1),
    db
      .select({ id: withdrawals.id })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.mexAccountId, mexAccountId),
          inArray(withdrawals.status, LIVE_WITHDRAWAL_STATES),
        ),
      )
      .limit(1),
  ]);
  if (manual.length || bounce.length || withdrawal.length) {
    throw new Error('La cuenta MEX tiene trabajo financiero activo');
  }
}

async function createValidatedOperation(
  admin: RevalidatedAdmin,
  userId: string,
  input: CreateInput,
  extendedFrom?: string,
): Promise<string> {
  const nominal = validateManualNominal(input.nominalAmount, input.fromAsset);
  if (
    !SUPPORTED_PAIRS.some(
      (pair) => pair.asset === input.fromAsset && pair.network === input.fromNetwork,
    )
  ) {
    throw new Error('Activo o red de entrada no soportados');
  }

  const [user, mex, maintenance] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.mexAccounts.findFirst({ where: eq(mexAccounts.userId, userId) }),
    db.query.systemSettings.findFirst({ where: eq(systemSettings.key, 'maintenance_mode') }),
  ]);
  if (!user || user.status !== 'approved' || user.deletedAt) throw new Error('Usuario no aprobado');
  if (!mex || mex.status !== 'active') throw new Error('La cuenta MEX no está activa');
  const maintenanceValue = maintenance?.value as { enabled?: boolean } | boolean | undefined;
  if (
    maintenanceValue === true ||
    (typeof maintenanceValue === 'object' && maintenanceValue?.enabled)
  ) {
    throw new Error('El sistema está en mantenimiento');
  }
  await assertNoFinancialWork(mex.id);

  const mexClient = buildWebMexClient(mex);
  const [exchangeInfo, capital, quote, refund, depositAddress] = await Promise.all([
    mexClient.getExchangeInfo(),
    mexClient.getCapitalConfig(),
    resolveFreshQuote(input.fromAsset, input.toAsset),
    input.refundWalletId
      ? db.query.destinationWallets.findFirst({
          where: and(
            eq(destinationWallets.id, input.refundWalletId),
            eq(destinationWallets.userId, userId),
            eq(destinationWallets.asset, input.fromAsset),
            eq(destinationWallets.network, input.fromNetwork),
            isNull(destinationWallets.deletedAt),
          ),
        })
      : Promise.resolve(undefined),
    db.query.mexDepositAddresses.findFirst({
      where: and(
        eq(mexDepositAddresses.mexAccountId, mex.id),
        eq(mexDepositAddresses.coin, input.fromAsset),
        eq(mexDepositAddresses.network, input.fromNetwork),
        eq(mexDepositAddresses.status, 'ok'),
      ),
    }),
  ]);
  if (input.refundWalletId && !refund) throw new Error('Wallet de devolución inválida');
  if (!depositAddress?.address) throw new Error('La dirección de depósito MEX no está lista');

  const output = buildMexOutputCatalog(input.fromAsset, exchangeInfo, capital).find(
    (candidate) => candidate.asset === input.toAsset,
  );
  const payoutNetwork = output
    ? selectMexOutputNetwork(output, input.payoutMexCoin, input.payoutMexNetwork)
    : undefined;
  if (!output || !payoutNetwork) {
    throw new Error('El activo o la red de salida ya no están habilitados en MEX');
  }
  if (input.toNetwork !== input.payoutMexNetwork && input.toNetwork !== payoutNetwork.mexNetwork) {
    throw new Error('La red payout seleccionada no coincide');
  }
  if (!matchesMexPattern(input.payoutAddress, payoutNetwork.addressRegex)) {
    throw new Error('La dirección payout no tiene el formato esperado para esta red');
  }
  if (payoutNetwork.memoRequired && !input.payoutMemo) {
    throw new Error('Esta red requiere memo/tag para el payout');
  }
  if (input.payoutMemo && !matchesMexPattern(input.payoutMemo, payoutNetwork.memoRegex)) {
    throw new Error('El memo/tag no tiene el formato esperado para esta red');
  }
  if (output.symbol !== quote.symbol || output.side !== quote.side) {
    throw new Error('El mercado de salida cambió; recargá el catálogo');
  }
  const payoutFee = Number(payoutNetwork.withdrawFee);
  if (!Number.isFinite(payoutFee) || payoutFee < 0) {
    throw new Error('MEX no informó un fee de retiro válido');
  }
  const estimatedOutput = await estimateOutput(userId, nominal, input.toAsset, payoutFee, quote);
  const recent = await db
    .select({ expected: manualOperations.expectedDepositAmount })
    .from(manualOperations)
    .where(
      and(
        eq(manualOperations.userId, userId),
        eq(manualOperations.fromAsset, input.fromAsset),
        eq(manualOperations.fromNetwork, input.fromNetwork),
        gte(manualOperations.createdAt, new Date(Date.now() - 24 * 60 * 60_000)),
      ),
    )
    .orderBy(desc(manualOperations.createdAt));
  const used = new Set(recent.map((row) => row.expected));
  let verifier = '';
  let expected = '';
  for (let attempt = 0; attempt < 99; attempt += 1) {
    verifier = String(randomInt(1, 100)).padStart(2, '0');
    expected = buildExpectedDepositAmount(nominal, verifier, input.fromAsset);
    if (!used.has(expected)) break;
    expected = '';
  }
  if (!expected) throw new Error('No se pudo generar un monto verificador único');

  const operationId = crypto.randomUUID();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mex.id}))`);
    const lease = await tx
      .select({ id: financialAccountLocks.mexAccountId })
      .from(financialAccountLocks)
      .where(
        and(
          eq(financialAccountLocks.mexAccountId, mex.id),
          sql`${financialAccountLocks.expiresAt} > now()`,
        ),
      )
      .limit(1);
    if (lease.length > 0) throw new Error('La cuenta MEX está reservada por otro proceso');
    const concurrentManual = await tx
      .select({ id: manualOperations.id })
      .from(manualOperations)
      .where(
        and(
          eq(manualOperations.mexAccountId, mex.id),
          inArray(manualOperations.state, [...ACTIVE_MANUAL_STATES]),
        ),
      )
      .limit(1);
    if (concurrentManual.length > 0) throw new Error('La cuenta MEX ya tiene una operación manual');
    const concurrentBounce = await tx
      .select({ id: bounceJobs.id })
      .from(bounceJobs)
      .innerJoin(deposits, eq(deposits.id, bounceJobs.depositId))
      .where(and(eq(deposits.mexAccountId, mex.id), inArray(bounceJobs.state, LIVE_BOUNCE_STATES)))
      .limit(1);
    const concurrentWithdrawal = await tx
      .select({ id: withdrawals.id })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.mexAccountId, mex.id),
          inArray(withdrawals.status, LIVE_WITHDRAWAL_STATES),
        ),
      )
      .limit(1);
    if (concurrentBounce.length > 0 || concurrentWithdrawal.length > 0) {
      throw new Error('La cuenta MEX tiene trabajo financiero activo');
    }
    await tx.insert(manualOperations).values({
      id: operationId,
      userId,
      mexAccountId: mex.id,
      createdByAdminId: admin.id,
      fromAsset: input.fromAsset,
      fromNetwork: input.fromNetwork,
      toAsset: input.toAsset,
      toNetwork: payoutNetwork.mexNetwork,
      nominalAmount: nominal,
      verifierDigits: verifier,
      expectedDepositAmount: expected,
      estimatedOutput,
      payoutWalletId: null,
      payoutAddress: input.payoutAddress,
      payoutMemo: input.payoutMemo || null,
      payoutMexCoin: payoutNetwork.mexCoin,
      payoutMexNetwork: payoutNetwork.mexNetwork,
      refundWalletId: refund?.id,
      refundAddress: refund?.address,
      refundMemo: refund?.memo,
      spotSymbol: quote.symbol,
      spotSide: quote.side,
      internalNotes: input.internalNotes || null,
      expiresAt: new Date(now.getTime() + MANUAL_OPERATION_TTL_MS),
    });
    await tx.insert(auditLog).values({
      actorId: admin.id,
      action: extendedFrom ? 'manual_op_extended' : 'manual_op_created',
      targetType: 'manual_operation',
      targetId: operationId,
      payload: {
        oldOpId: extendedFrom,
        pair: `${input.fromAsset}/${input.fromNetwork}->${input.toAsset}/${payoutNetwork.mexNetwork}`,
        nominal,
        expected,
        payoutMexCoin: payoutNetwork.mexCoin,
        payoutMexNetwork: payoutNetwork.mexNetwork,
        refundWalletId: refund?.id ?? null,
      },
    });
    if (user.telegramId) {
      await tx
        .insert(telegramMessages)
        .values({
          userId,
          chatId: String(user.telegramId),
          direction: 'out',
          type: 'manual_op_created',
          rawPayload: {
            text: `Operación creada: depositá ${expected} ${input.fromAsset} (${input.fromNetwork}) a ${depositAddress.address}${depositAddress.memo ? ` memo ${depositAddress.memo}` : ''} en los próximos 15 min. Vas a recibir ${input.toAsset} en ${payoutNetwork.mexNetwork}. Código: ${verifier}`,
          },
          dedupeKey: `manual-op:${operationId}:created:0`,
        })
        .onConflictDoNothing();
    }
  });
  revalidateManualPaths(userId, operationId);
  return operationId;
}

function revalidateManualPaths(userId?: string, operationId?: string): void {
  revalidatePath('/admin/manual-operations');
  if (operationId) revalidatePath(`/admin/manual-operations/${operationId}`);
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

export async function createManualOperationAction(
  userId: string,
  _previous: ManualActionState,
  formData: FormData,
): Promise<ManualActionState> {
  try {
    const admin = await requireRevalidatedAdmin();
    const input = createSchema.parse({
      fromAsset: formString(formData, 'fromAsset'),
      fromNetwork: formString(formData, 'fromNetwork'),
      toAsset: formString(formData, 'toAsset'),
      toNetwork: formString(formData, 'toNetwork'),
      nominalAmount: formString(formData, 'nominalAmount'),
      payoutAddress: formString(formData, 'payoutAddress'),
      payoutMemo: formString(formData, 'payoutMemo'),
      payoutMexCoin: formString(formData, 'payoutMexCoin'),
      payoutMexNetwork: formString(formData, 'payoutMexNetwork'),
      payoutConfirmed: formString(formData, 'payoutConfirmed'),
      refundWalletId: formString(formData, 'refundWalletId'),
      internalNotes: formString(formData, 'internalNotes'),
    });
    const operationId = await createValidatedOperation(admin, userId, input);
    return { ok: true, operationId };
  } catch (error) {
    return resultError(error);
  }
}

export async function extendManualOperationAction(
  operationId: string,
  formData: FormData,
): Promise<void> {
  const admin = await requireAdminTotp(formString(formData, 'totpCode'));
  const op = await db.query.manualOperations.findFirst({
    where: eq(manualOperations.id, operationId),
  });
  if (!op || op.state !== 'expired')
    throw new Error('Solo se puede extender una operación expirada');
  const candidate = await db.query.manualOperationDeposits.findFirst({
    where: eq(manualOperationDeposits.manualOperationId, operationId),
  });
  if (candidate) throw new Error('No se puede extender una operación con candidatos');
  await createValidatedOperation(
    admin,
    op.userId,
    {
      fromAsset: op.fromAsset as Asset,
      fromNetwork: op.fromNetwork,
      toAsset: op.toAsset,
      toNetwork: op.toNetwork,
      nominalAmount: op.nominalAmount,
      payoutAddress: op.payoutAddress,
      payoutMemo: op.payoutMemo ?? '',
      payoutMexCoin: op.payoutMexCoin ?? op.toAsset,
      payoutMexNetwork: op.payoutMexNetwork ?? op.toNetwork,
      payoutConfirmed: 'on',
      refundWalletId: op.refundWalletId ?? '',
      internalNotes: op.internalNotes ?? '',
    },
    op.id,
  );
}

export async function cancelManualOperationAction(
  operationId: string,
  formData: FormData,
): Promise<void> {
  const admin = await requireAdminTotp(formString(formData, 'totpCode'));
  const reason = formString(formData, 'reason') || 'Cancelada por administrador';
  const op = await db.query.manualOperations.findFirst({
    where: eq(manualOperations.id, operationId),
  });
  if (!op || !(PRE_EXTERNAL_STATES as readonly string[]).includes(op.state)) {
    throw new Error('La operación ya no puede cancelarse de forma segura');
  }
  const selected = await db.query.manualOperationDeposits.findFirst({
    where: and(
      eq(manualOperationDeposits.manualOperationId, op.id),
      eq(manualOperationDeposits.status, 'selected'),
    ),
  });
  const candidates = await db
    .select({
      id: manualOperationDeposits.id,
      status: manualOperationDeposits.status,
      sourceAmountRaw: manualOperationDeposits.sourceAmountRaw,
      depositStatus: deposits.status,
    })
    .from(manualOperationDeposits)
    .innerJoin(deposits, eq(deposits.id, manualOperationDeposits.depositId))
    .where(
      and(
        eq(manualOperationDeposits.manualOperationId, op.id),
        eq(manualOperationDeposits.status, 'candidate'),
      ),
    );
  const confirmedCandidates = candidates.filter(
    (candidate) => candidate.depositStatus === 'confirmed',
  );
  const refundableCandidate =
    selected ?? (confirmedCandidates.length === 1 ? confirmedCandidates[0] : undefined);
  const receivedAmount = refundableCandidate?.sourceAmountRaw ?? op.receivedAmount;
  const nextState =
    !refundableCandidate && candidates.length > 0
      ? 'pending_candidate_resolution'
      : receivedAmount && op.refundWalletId
        ? 'refunding'
        : 'cancelled';
  if (refundableCandidate && refundableCandidate.status !== 'selected') {
    await db
      .update(manualOperationDeposits)
      .set({
        status: op.refundWalletId ? 'selected' : 'rejected',
        updatedAt: new Date(),
      })
      .where(eq(manualOperationDeposits.id, refundableCandidate.id));
  }
  const changed = await db
    .update(manualOperations)
    .set({
      state: nextState,
      receivedAmount,
      surplusAmount: receivedAmount,
      surplusAsset: op.fromAsset,
      terminalState: 'cancelled',
      rejectReason: reason,
      cancelledAt: nextState === 'cancelled' ? new Date() : null,
      updatedAt: new Date(),
      version: op.version + 1,
    })
    .where(and(eq(manualOperations.id, op.id), eq(manualOperations.state, op.state)))
    .returning({ id: manualOperations.id });
  if (!changed.length) throw new Error('La operación cambió; recargá e intentá nuevamente');
  await db.insert(auditLog).values({
    actorId: admin.id,
    action: 'manual_op_cancelled',
    targetType: 'manual_operation',
    targetId: op.id,
    payload: { reason, nextState },
  });
  revalidateManualPaths(op.userId, op.id);
}

export async function confirmMismatchAction(
  operationId: string,
  formData: FormData,
): Promise<void> {
  const admin = await requireAdminTotp(formString(formData, 'totpCode'));
  const candidateId = formString(formData, 'candidateId');
  const amountToExecute = formString(formData, 'amountToExecute');
  const maxSlippageBps = z.coerce
    .number()
    .int()
    .min(1)
    .max(5000)
    .parse(formString(formData, 'maxSlippageBps') || '200');
  const op = await db.query.manualOperations.findFirst({
    where: eq(manualOperations.id, operationId),
  });
  if (!op || op.state !== 'pending_admin_confirm')
    throw new Error('La operación ya no espera al admin');
  const candidate = await db.query.manualOperationDeposits.findFirst({
    where: and(
      eq(manualOperationDeposits.id, candidateId),
      eq(manualOperationDeposits.manualOperationId, op.id),
      eq(manualOperationDeposits.matchType, 'mismatch'),
      inArray(manualOperationDeposits.status, ['candidate', 'selected']),
    ),
  });
  if (!candidate) throw new Error('Candidato mismatch inválido');
  const sourceDeposit = await db.query.deposits.findFirst({
    where: eq(deposits.id, candidate.depositId),
  });
  if (sourceDeposit?.status !== 'confirmed') {
    throw new Error('El depósito todavía no está confirmado por MEX');
  }
  let surplus: string;
  try {
    surplus = calculateManualSurplus(
      candidate.sourceAmountRaw,
      amountToExecute,
      op.fromAsset as Asset,
    );
  } catch {
    throw new Error('El monto a ejecutar debe ser mayor a cero y no superar lo recibido');
  }
  const quote = await resolveFreshQuote(op.fromAsset, op.toAsset);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(manualOperationDeposits)
      .set({ status: 'candidate', updatedAt: now })
      .where(
        and(
          eq(manualOperationDeposits.manualOperationId, op.id),
          eq(manualOperationDeposits.status, 'selected'),
          ne(manualOperationDeposits.id, candidate.id),
        ),
      );
    await tx
      .update(manualOperationDeposits)
      .set({ status: 'selected', updatedAt: now })
      .where(
        and(
          eq(manualOperationDeposits.id, candidate.id),
          inArray(manualOperationDeposits.status, ['candidate', 'selected']),
        ),
      );
    const changed = await tx
      .update(manualOperations)
      .set({
        state: op.fromAsset === op.toAsset ? 'withdrawing' : 'converting',
        receivedAmount: candidate.sourceAmountRaw,
        amountToExecute,
        surplusAmount: surplus,
        surplusAsset: op.fromAsset,
        confirmationQuote: String(quote.price),
        confirmationQuoteAt: now,
        maxSlippageBps,
        confirmedByAdminId: admin.id,
        confirmedAt: now,
        updatedAt: now,
        version: op.version + 1,
      })
      .where(
        and(
          eq(manualOperations.id, op.id),
          eq(manualOperations.state, 'pending_admin_confirm'),
          eq(manualOperations.version, op.version),
        ),
      )
      .returning({ id: manualOperations.id });
    if (!changed.length) throw new Error('La operación cambió durante la confirmación');
    await tx.insert(auditLog).values({
      actorId: admin.id,
      action: 'manual_op_admin_confirmed',
      targetType: 'manual_operation',
      targetId: op.id,
      payload: { selectedDepositId: candidate.depositId, amountToExecute, maxSlippageBps },
    });
  });
  revalidateManualPaths(op.userId, op.id);
}

export async function rejectManualOperationAction(
  operationId: string,
  formData: FormData,
): Promise<void> {
  const admin = await requireAdminTotp(formString(formData, 'totpCode'));
  const reason = formString(formData, 'reason');
  if (reason.length < 3) throw new Error('Ingresá un motivo');
  const op = await db.query.manualOperations.findFirst({
    where: eq(manualOperations.id, operationId),
  });
  if (!op || op.state !== 'pending_admin_confirm')
    throw new Error('La operación ya no espera rechazo');
  const selected = await db.query.manualOperationDeposits.findFirst({
    where: and(
      eq(manualOperationDeposits.manualOperationId, op.id),
      eq(manualOperationDeposits.status, 'selected'),
    ),
  });
  const candidates = await db
    .select({
      id: manualOperationDeposits.id,
      status: manualOperationDeposits.status,
      sourceAmountRaw: manualOperationDeposits.sourceAmountRaw,
      depositStatus: deposits.status,
    })
    .from(manualOperationDeposits)
    .innerJoin(deposits, eq(deposits.id, manualOperationDeposits.depositId))
    .where(
      and(
        eq(manualOperationDeposits.manualOperationId, op.id),
        eq(manualOperationDeposits.status, 'candidate'),
      ),
    );
  const confirmedCandidates = candidates.filter(
    (candidate) => candidate.depositStatus === 'confirmed',
  );
  const refundableCandidate =
    selected ?? (confirmedCandidates.length === 1 ? confirmedCandidates[0] : undefined);
  const receivedAmount = refundableCandidate?.sourceAmountRaw ?? op.receivedAmount;
  const nextState =
    !refundableCandidate && candidates.length > 0
      ? 'pending_candidate_resolution'
      : receivedAmount && op.refundWalletId
        ? 'refunding'
        : 'cancelled';
  if (refundableCandidate && refundableCandidate.status !== 'selected') {
    await db
      .update(manualOperationDeposits)
      .set({
        status: op.refundWalletId ? 'selected' : 'rejected',
        updatedAt: new Date(),
      })
      .where(eq(manualOperationDeposits.id, refundableCandidate.id));
  }
  const changed = await db
    .update(manualOperations)
    .set({
      state: nextState,
      receivedAmount,
      surplusAmount: receivedAmount,
      surplusAsset: op.fromAsset,
      terminalState: 'cancelled',
      rejectReason: reason,
      cancelledAt: nextState === 'cancelled' ? new Date() : null,
      updatedAt: new Date(),
      version: op.version + 1,
    })
    .where(
      and(
        eq(manualOperations.id, op.id),
        eq(manualOperations.state, 'pending_admin_confirm'),
        eq(manualOperations.version, op.version),
      ),
    )
    .returning({ id: manualOperations.id });
  if (!changed.length) throw new Error('La operación cambió durante el rechazo');
  await db.insert(auditLog).values({
    actorId: admin.id,
    action: 'manual_op_rejected',
    targetType: 'manual_operation',
    targetId: op.id,
    payload: { reason, nextState },
  });
  revalidateManualPaths(op.userId, op.id);
}

export async function retryManualOperationAction(
  operationId: string,
  formData: FormData,
): Promise<void> {
  const admin = await requireAdminTotp(formString(formData, 'totpCode'));
  const op = await db.query.manualOperations.findFirst({
    where: eq(manualOperations.id, operationId),
  });
  if (!op || op.state !== 'on_hold' || !op.resumeState)
    throw new Error('No hay estado seguro para reintentar');
  const changed = await db
    .update(manualOperations)
    .set({
      state: op.resumeState,
      resumeState: null,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      version: op.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(manualOperations.id, op.id),
        eq(manualOperations.state, 'on_hold'),
        eq(manualOperations.version, op.version),
      ),
    )
    .returning({ id: manualOperations.id });
  if (!changed.length) throw new Error('La operación cambió durante el retry');
  await db.insert(auditLog).values({
    actorId: admin.id,
    action: 'manual_op_retried',
    targetType: 'manual_operation',
    targetId: op.id,
    payload: { resumeState: op.resumeState },
  });
  revalidateManualPaths(op.userId, op.id);
}

export async function releaseCandidateToBounceAction(
  candidateId: string,
  formData: FormData,
): Promise<void> {
  const admin = await requireAdminTotp(formString(formData, 'totpCode'));
  const candidate = await db.query.manualOperationDeposits.findFirst({
    where: eq(manualOperationDeposits.id, candidateId),
  });
  if (!candidate) throw new Error('Candidato no encontrado');
  const op = await db.query.manualOperations.findFirst({
    where: eq(manualOperations.id, candidate.manualOperationId),
  });
  if (!op || !['pending_candidate_resolution', 'cancelled', 'done'].includes(op.state)) {
    throw new Error('El candidato todavía no puede liberarse');
  }
  if (candidate.status === 'released_to_bounce') return;
  if (!['candidate', 'rejected'].includes(candidate.status))
    throw new Error('Estado de candidato inválido');
  const sourceDeposit = await db.query.deposits.findFirst({
    where: eq(deposits.id, candidate.depositId),
  });
  if (sourceDeposit?.status !== 'confirmed') {
    throw new Error('El depósito todavía no está confirmado por MEX');
  }

  await db.transaction(async (tx) => {
    const jobId = crypto.randomUUID();
    const inserted = await tx
      .insert(bounceJobs)
      .values({
        id: jobId,
        depositId: candidate.depositId,
        withdrawOrderId: userPayoutOrderId(jobId),
        state: 'pending',
      })
      .onConflictDoNothing({ target: bounceJobs.depositId })
      .returning({ id: bounceJobs.id });
    const existing =
      inserted[0] ??
      (
        await tx
          .select({ id: bounceJobs.id })
          .from(bounceJobs)
          .where(eq(bounceJobs.depositId, candidate.depositId))
          .limit(1)
      )[0];
    if (!existing) throw new Error('No se pudo crear o recuperar el bounce');
    await tx
      .update(manualOperationDeposits)
      .set({ status: 'released_to_bounce', updatedAt: new Date() })
      .where(
        and(
          eq(manualOperationDeposits.id, candidate.id),
          inArray(manualOperationDeposits.status, ['candidate', 'rejected']),
        ),
      );
    await tx
      .update(deposits)
      .set({ status: 'queued', updatedAt: new Date() })
      .where(eq(deposits.id, candidate.depositId));
    await tx.insert(auditLog).values({
      actorId: admin.id,
      action: 'manual_op_candidate_released',
      targetType: 'manual_operation',
      targetId: op.id,
      payload: { depositId: candidate.depositId, bounceJobId: existing.id },
    });
    const unresolved = await tx
      .select({ id: manualOperationDeposits.id })
      .from(manualOperationDeposits)
      .where(
        and(
          eq(manualOperationDeposits.manualOperationId, op.id),
          eq(manualOperationDeposits.status, 'candidate'),
        ),
      )
      .limit(1);
    if (unresolved.length === 0 && op.state === 'pending_candidate_resolution') {
      const terminalState = op.terminalState === 'cancelled' ? 'cancelled' : 'done';
      await tx
        .update(manualOperations)
        .set({
          state: terminalState,
          completedAt: new Date(),
          cancelledAt: terminalState === 'cancelled' ? new Date() : op.cancelledAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(manualOperations.id, op.id),
            eq(manualOperations.state, 'pending_candidate_resolution'),
          ),
        );
    }
  });
  revalidateManualPaths(op.userId, op.id);
}
