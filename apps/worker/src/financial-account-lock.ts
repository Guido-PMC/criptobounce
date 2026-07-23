import type { Database } from '@rb/db';
import { financialAccountLocks, manualOperations } from '@rb/db';
import type { ManualOperationState } from '@rb/domain';
import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';

export const FINANCIAL_LOCKING_MANUAL_STATES = [
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
] as const satisfies readonly ManualOperationState[];

export function isFinanciallyLockingManualState(state: string): boolean {
  return (FINANCIAL_LOCKING_MANUAL_STATES as readonly string[]).includes(state);
}

/**
 * Conservative account-level reservation. Call immediately before every
 * balance-consuming action; an operation in on_hold intentionally keeps it.
 */
export async function isFinancialAccountLocked(
  db: Database,
  mexAccountId: string,
  excludeManualOperationId?: string,
): Promise<boolean> {
  const filters = [
    eq(manualOperations.mexAccountId, mexAccountId),
    inArray(manualOperations.state, [...FINANCIAL_LOCKING_MANUAL_STATES]),
  ];
  if (excludeManualOperationId) filters.push(ne(manualOperations.id, excludeManualOperationId));

  const row = await db
    .select({ id: manualOperations.id })
    .from(manualOperations)
    .where(and(...filters))
    .limit(1);
  if (row.length > 0) return true;
  const lease = await db
    .select({ id: financialAccountLocks.mexAccountId })
    .from(financialAccountLocks)
    .where(
      and(
        eq(financialAccountLocks.mexAccountId, mexAccountId),
        sql`${financialAccountLocks.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return lease.length > 0;
}

export async function claimFinancialAccountLease(
  db: Database,
  mexAccountId: string,
  ownerType: string,
  ownerId: string,
  ttlMs = 60 * 60_000,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mexAccountId}))`);
    await tx
      .delete(financialAccountLocks)
      .where(
        and(
          eq(financialAccountLocks.mexAccountId, mexAccountId),
          lt(financialAccountLocks.expiresAt, new Date()),
        ),
      );
    const manual = await tx
      .select({ id: manualOperations.id })
      .from(manualOperations)
      .where(
        and(
          eq(manualOperations.mexAccountId, mexAccountId),
          inArray(manualOperations.state, [...FINANCIAL_LOCKING_MANUAL_STATES]),
        ),
      )
      .limit(1);
    if (manual.length > 0) return false;
    const inserted = await tx
      .insert(financialAccountLocks)
      .values({
        mexAccountId,
        ownerType,
        ownerId,
        expiresAt: new Date(Date.now() + ttlMs),
      })
      .onConflictDoNothing()
      .returning({ id: financialAccountLocks.mexAccountId });
    return inserted.length > 0;
  });
}

export async function releaseFinancialAccountLease(
  db: Database,
  mexAccountId: string,
  ownerId: string,
): Promise<void> {
  await db
    .delete(financialAccountLocks)
    .where(
      and(
        eq(financialAccountLocks.mexAccountId, mexAccountId),
        eq(financialAccountLocks.ownerId, ownerId),
      ),
    );
}
