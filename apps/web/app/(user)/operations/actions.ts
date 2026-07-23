'use server';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import {
  auditLog,
  manualOperationDeposits,
  manualOperations,
  telegramMessages,
  users,
} from '@rb/db';
import {
  type Asset,
  DEFAULT_MANUAL_OPERATION_SLIPPAGE_BPS,
  calculateManualSurplus,
  candidateSpotPairs,
} from '@rb/domain';
import { MexClient, fetchBookTickers } from '@rb/mex-client';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export interface ConfirmManualOperationState {
  ok: boolean;
  error?: string;
}

function isTradableStatus(status: string | undefined): boolean {
  return status !== undefined && ['1', 'TRADING', 'ENABLED'].includes(status.toUpperCase());
}

async function resolveFreshQuote(
  from: Asset,
  to: Asset,
): Promise<{ symbol: string | null; side: 'BUY' | 'SELL' | null; price: string }> {
  if (from === to) return { symbol: null, side: null, price: '1' };

  const client = new MexClient({ apiKey: '', apiSecret: '' });
  for (const candidate of candidateSpotPairs(from, to)) {
    const info = await client.getSymbolInfo(candidate.symbol);
    if (!info || info.symbol !== candidate.symbol || !isTradableStatus(info.status)) continue;

    const [ticker] = await fetchBookTickers([candidate.symbol], { timeoutMs: 4_000 });
    if (!ticker || ticker.symbol !== candidate.symbol) continue;
    const price = candidate.side === 'SELL' ? ticker.bid : ticker.ask;
    if (!Number.isFinite(price) || price <= 0) continue;

    return { symbol: candidate.symbol, side: candidate.side, price: String(price) };
  }

  throw new Error(`El mercado MEX directo ${from}/${to} no está disponible`);
}

export async function confirmManualOperationAction(
  operationId: string,
  _previous: ConfirmManualOperationState,
): Promise<ConfirmManualOperationState> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, error: 'No autorizado' };

    const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
    if (!user || user.status !== 'approved' || user.deletedAt) {
      return { ok: false, error: 'Tu cuenta no está habilitada' };
    }

    const operation = await db.query.manualOperations.findFirst({
      where: and(
        eq(manualOperations.id, operationId),
        eq(manualOperations.userId, user.id),
        eq(manualOperations.state, 'pending_user_confirm'),
      ),
    });
    if (!operation) {
      return { ok: false, error: 'La operación ya no está disponible para confirmar' };
    }

    const selected = await db.query.manualOperationDeposits.findFirst({
      where: and(
        eq(manualOperationDeposits.manualOperationId, operation.id),
        eq(manualOperationDeposits.matchType, 'exact'),
        eq(manualOperationDeposits.status, 'selected'),
      ),
    });
    if (!selected) return { ok: false, error: 'No hay un depósito exacto seleccionado' };

    const surplus = calculateManualSurplus(
      selected.sourceAmountRaw,
      operation.nominalAmount,
      operation.fromAsset as Asset,
    );
    const quote = await resolveFreshQuote(operation.fromAsset as Asset, operation.toAsset as Asset);
    const now = new Date();
    const nextState = operation.fromAsset === operation.toAsset ? 'withdrawing' : 'converting';

    await db.transaction(async (tx) => {
      const candidate = await tx.query.manualOperationDeposits.findFirst({
        where: and(
          eq(manualOperationDeposits.id, selected.id),
          eq(manualOperationDeposits.manualOperationId, operation.id),
          eq(manualOperationDeposits.matchType, 'exact'),
          eq(manualOperationDeposits.status, 'selected'),
        ),
      });
      if (!candidate) throw new Error('El depósito seleccionado cambió; recargá la página');

      const changed = await tx
        .update(manualOperations)
        .set({
          state: nextState,
          receivedAmount: candidate.sourceAmountRaw,
          amountToExecute: operation.nominalAmount,
          surplusAmount: surplus,
          surplusAsset: operation.fromAsset,
          spotSymbol: quote.symbol,
          spotSide: quote.side,
          confirmationQuote: quote.price,
          confirmationQuoteAt: now,
          maxSlippageBps: DEFAULT_MANUAL_OPERATION_SLIPPAGE_BPS,
          confirmedByUserId: user.id,
          confirmedAt: now,
          updatedAt: now,
          version: operation.version + 1,
        })
        .where(
          and(
            eq(manualOperations.id, operation.id),
            eq(manualOperations.userId, user.id),
            eq(manualOperations.state, 'pending_user_confirm'),
            eq(manualOperations.version, operation.version),
          ),
        )
        .returning({ id: manualOperations.id });
      if (!changed.length) throw new Error('La operación cambió durante la confirmación');

      await tx.insert(auditLog).values({
        actorId: user.id,
        action: 'manual_op_user_confirmed',
        targetType: 'manual_operation',
        targetId: operation.id,
        payload: {
          selectedDepositId: candidate.depositId,
          amountToExecute: operation.nominalAmount,
          surplus,
          quote: quote.price,
          quoteAt: now.toISOString(),
          maxSlippageBps: DEFAULT_MANUAL_OPERATION_SLIPPAGE_BPS,
        },
      });

      if (user.telegramId) {
        await tx
          .insert(telegramMessages)
          .values({
            operationId: operation.id,
            userId: user.id,
            chatId: String(user.telegramId),
            direction: 'out',
            type: 'manual_op_user_confirmed',
            rawPayload: { text: 'Operación confirmada, procesando…' },
            dedupeKey: `manual-op:${operation.id}:user-confirmed:${operation.version + 1}`,
          })
          .onConflictDoNothing();
      }
    });

    revalidatePath('/operations');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo confirmar la operación',
    };
  }
}
