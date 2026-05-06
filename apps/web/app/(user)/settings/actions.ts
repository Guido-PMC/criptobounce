'use server';

import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { auditLog, users } from '@rb/db';
import { clampReceiptSpread } from '@rb/domain';

export async function setPauseAction({
  global,
  assets,
}: { global: boolean; assets: string[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const userId = session.user.id;

  await db
    .update(users)
    .set({ isPaused: global, pausedAssets: assets })
    .where(eq(users.id, userId));

  await db.insert(auditLog).values({
    actorId: userId,
    action: 'pause_updated',
    targetType: 'user',
    targetId: userId,
    payload: { global, assets },
  });

  return { ok: true };
}

/**
 * Persists the cosmetic receipt spread (slider 0..5%) on the user record.
 * Only affects how comprobantes for FUTURE non-USDT->USDT bounces render
 * (existing comprobantes have a frozen snapshot).
 */
export async function setReceiptSpreadAction({
  percent,
}: {
  percent: number;
}): Promise<{ ok: true; percent: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const userId = session.user.id;

  // The slider promises 0..5% in steps of 0.05%; clamp here for safety in
  // case the client posts something out of range.
  const clamped = Math.min(0.05, clampReceiptSpread(percent));
  // Round to 5 decimals to match the numeric(6,5) column.
  const rounded = Math.round(clamped * 1e5) / 1e5;

  await db
    .update(users)
    .set({ receiptSpreadPercent: rounded.toFixed(5) })
    .where(eq(users.id, userId));

  await db.insert(auditLog).values({
    actorId: userId,
    action: 'receipt_spread_updated',
    targetType: 'user',
    targetId: userId,
    payload: { percent: rounded },
  });

  return { ok: true, percent: rounded };
}
