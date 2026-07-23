import { db } from '@/lib/db';
import { manualOperations, mexDepositAddresses } from '@rb/db';
import { and, desc, eq, inArray } from 'drizzle-orm';

export const ACTIVE_MANUAL_OPERATION_STATES = [
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

export interface ActiveManualOperationPayload {
  id: string;
  state: string;
  fromAsset: string;
  fromNetwork: string;
  toAsset: string;
  toNetwork: string;
  expectedDepositAmount: string;
  receivedAmount: string | null;
  estimatedOutput: string | null;
  depositAddress: string | null;
  depositMemo: string | null;
  expiresAt: string;
  updatedAt: string;
}

export async function getActiveManualOperationForUser(
  userId: string,
): Promise<ActiveManualOperationPayload | null> {
  const [operation] = await db
    .select()
    .from(manualOperations)
    .where(
      and(
        eq(manualOperations.userId, userId),
        inArray(manualOperations.state, [...ACTIVE_MANUAL_OPERATION_STATES]),
      ),
    )
    .orderBy(desc(manualOperations.createdAt))
    .limit(1);

  if (!operation) return null;

  const address = await db.query.mexDepositAddresses.findFirst({
    where: and(
      eq(mexDepositAddresses.mexAccountId, operation.mexAccountId),
      eq(mexDepositAddresses.coin, operation.fromAsset),
      eq(mexDepositAddresses.network, operation.fromNetwork),
      eq(mexDepositAddresses.status, 'ok'),
    ),
  });

  return {
    id: operation.id,
    state: operation.state,
    fromAsset: operation.fromAsset,
    fromNetwork: operation.fromNetwork,
    toAsset: operation.toAsset,
    toNetwork: operation.toNetwork,
    expectedDepositAmount: operation.expectedDepositAmount,
    receivedAmount: operation.receivedAmount,
    estimatedOutput: operation.estimatedOutput,
    depositAddress: address?.address ?? null,
    depositMemo: address?.memo ?? null,
    expiresAt: operation.expiresAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
  };
}
