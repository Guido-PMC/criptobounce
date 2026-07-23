import type { Database, Deposit } from '@rb/db';
import { deposits, manualOperationDeposits, manualOperations, systemSettings } from '@rb/db';
import { type Asset, manualAmountsEqual } from '@rb/domain';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { notify, tpl } from './notifier';

const MATCHABLE_STATES = [
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

const PRE_EXECUTION_STATES = [
  'awaiting_deposit_confirmation',
  'pending_user_confirm',
  'pending_admin_confirm',
] as const;

export type ManualMatchResult =
  | { action: 'none' }
  | { action: 'candidate'; opId: string; exact: boolean }
  | { action: 'blocked'; opId: string };

export function classifyManualDeposit(
  amountRaw: string,
  expectedAmount: string,
  asset: Asset,
): 'exact' | 'mismatch' {
  return manualAmountsEqual(amountRaw, expectedAmount, asset) ? 'exact' : 'mismatch';
}

/**
 * Captures a deposit for an active manual operation and, when confirmed,
 * selects an exact candidate or escalates a mismatch. The unique deposit FK,
 * selected partial index, and compare-and-set state updates make repeated MEX
 * polls harmless.
 */
export async function tryMatchManualOperation(
  db: Database,
  userId: string,
  dep: Deposit,
  sourceInsertedAt: Date,
  confirmed: boolean,
): Promise<ManualMatchResult> {
  const amountRaw = dep.amountRaw ?? dep.amount;
  const outcome = await db.transaction(async (tx) => {
    const alreadyLinked = await tx.query.manualOperationDeposits.findFirst({
      where: eq(manualOperationDeposits.depositId, dep.id),
    });

    let op = alreadyLinked
      ? await tx.query.manualOperations.findFirst({
          where: eq(manualOperations.id, alreadyLinked.manualOperationId),
        })
      : await tx.query.manualOperations.findFirst({
          where: and(
            eq(manualOperations.userId, userId),
            eq(manualOperations.mexAccountId, dep.mexAccountId),
            eq(manualOperations.fromAsset, dep.asset),
            eq(manualOperations.fromNetwork, dep.network),
            inArray(manualOperations.state, [...MATCHABLE_STATES]),
            lte(manualOperations.createdAt, sourceInsertedAt),
          ),
          orderBy: [asc(manualOperations.createdAt)],
        });

    if (!op) return { result: { action: 'none' } as ManualMatchResult, event: null };
    if (!(MATCHABLE_STATES as readonly string[]).includes(op.state)) {
      return {
        result: alreadyLinked
          ? ({ action: 'blocked', opId: op.id } as ManualMatchResult)
          : ({ action: 'none' } as ManualMatchResult),
        event: null,
      };
    }
    if (
      !alreadyLinked &&
      op.state === 'awaiting_deposit' &&
      sourceInsertedAt.getTime() > op.expiresAt.getTime()
    ) {
      return { result: { action: 'none' } as ManualMatchResult, event: null };
    }

    const matchType = classifyManualDeposit(
      amountRaw,
      op.expectedDepositAmount,
      dep.asset as Asset,
    );

    if (!alreadyLinked) {
      if (op.state === 'awaiting_deposit') {
        const claimed = await tx
          .update(manualOperations)
          .set({
            state: 'awaiting_deposit_confirmation',
            matchedAt: new Date(),
            updatedAt: new Date(),
            version: op.version + 1,
          })
          .where(
            and(eq(manualOperations.id, op.id), eq(manualOperations.state, 'awaiting_deposit')),
          )
          .returning();
        if (claimed.length === 0) {
          op = await tx.query.manualOperations.findFirst({
            where: eq(manualOperations.id, op.id),
          });
          if (!op || op.state === 'expired') {
            return { result: { action: 'none' } as ManualMatchResult, event: null };
          }
        } else {
          op = claimed[0]!;
        }
      }

      await tx
        .insert(manualOperationDeposits)
        .values({
          manualOperationId: op.id,
          depositId: dep.id,
          matchType,
          status: 'candidate',
          sourceAmountRaw: amountRaw,
          sourceInsertedAt,
        })
        .onConflictDoNothing();
    }

    if (!confirmed) {
      return {
        result: {
          action: 'candidate',
          opId: op.id,
          exact: matchType === 'exact',
        } as ManualMatchResult,
        event: alreadyLinked ? null : ('detected' as const),
      };
    }

    const link =
      alreadyLinked ??
      (await tx.query.manualOperationDeposits.findFirst({
        where: eq(manualOperationDeposits.depositId, dep.id),
      }));
    if (!link) {
      return { result: { action: 'blocked', opId: op.id } as ManualMatchResult, event: null };
    }

    if (link.matchType === 'exact') {
      const selected = await tx.query.manualOperationDeposits.findFirst({
        where: and(
          eq(manualOperationDeposits.manualOperationId, op.id),
          eq(manualOperationDeposits.status, 'selected'),
        ),
      });
      const canAutoSelect = (PRE_EXECUTION_STATES as readonly string[]).includes(op.state);
      if (canAutoSelect && (!selected || selected.depositId === dep.id)) {
        await tx
          .update(manualOperationDeposits)
          .set({ status: 'selected', updatedAt: new Date() })
          .where(eq(manualOperationDeposits.id, link.id));
        await tx
          .update(manualOperations)
          .set({
            state: 'pending_user_confirm',
            receivedAmount: amountRaw,
            matchedAt: op.matchedAt ?? new Date(),
            updatedAt: new Date(),
            version: op.version + 1,
          })
          .where(
            and(
              eq(manualOperations.id, op.id),
              inArray(manualOperations.state, [...PRE_EXECUTION_STATES]),
            ),
          );
      }
      return {
        result: { action: 'candidate', opId: op.id, exact: true } as ManualMatchResult,
        event: canAutoSelect && link.status !== 'selected' ? ('exact' as const) : null,
      };
    }

    const selected = await tx.query.manualOperationDeposits.findFirst({
      where: and(
        eq(manualOperationDeposits.manualOperationId, op.id),
        eq(manualOperationDeposits.status, 'selected'),
      ),
    });
    if (!selected && (PRE_EXECUTION_STATES as readonly string[]).includes(op.state)) {
      await tx
        .update(manualOperations)
        .set({
          state: 'pending_admin_confirm',
          matchedAt: op.matchedAt ?? new Date(),
          updatedAt: new Date(),
          version: op.version + 1,
        })
        .where(
          and(
            eq(manualOperations.id, op.id),
            inArray(manualOperations.state, [...PRE_EXECUTION_STATES]),
          ),
        );
    }
    return {
      result: { action: 'candidate', opId: op.id, exact: false } as ManualMatchResult,
      event: alreadyLinked && dep.status === 'confirmed' ? null : ('mismatch' as const),
    };
  });

  if (outcome.result.action === 'none' || !outcome.event) return outcome.result;
  const op = await db.query.manualOperations.findFirst({
    where: eq(manualOperations.id, outcome.result.opId),
  });
  if (!op) return outcome.result;

  if (outcome.event === 'detected') {
    await notify(db, {
      type: 'manual_op_deposit_detected',
      userId,
      text: tpl.manualDepositDetected(),
      dedupeKey: `manual-op:${op.id}:deposit-detected:${dep.id}`,
    });
  } else if (outcome.event === 'exact') {
    await notify(db, {
      type: 'manual_op_deposit_exact',
      userId,
      text: tpl.manualDepositExact(amountRaw, dep.asset),
      dedupeKey: `manual-op:${op.id}:deposit-exact:${dep.id}`,
    });
  } else {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'manual_ops_admin_chat_id'),
    });
    const value = setting?.value as { chatId?: unknown } | string | number | undefined;
    const chatId =
      typeof value === 'object' && value !== null
        ? typeof value.chatId === 'string' || typeof value.chatId === 'number'
          ? String(value.chatId)
          : undefined
        : typeof value === 'string' || typeof value === 'number'
          ? String(value)
          : undefined;
    await notify(db, {
      type: 'manual_op_deposit_mismatch',
      chatId,
      text: tpl.manualDepositMismatch(amountRaw, op.expectedDepositAmount, dep.asset, op.id),
      dedupeKey: `manual-op:${op.id}:deposit-mismatch:${dep.id}`,
    });
  }
  return outcome.result;
}
