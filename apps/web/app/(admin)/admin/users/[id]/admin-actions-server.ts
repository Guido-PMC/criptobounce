'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { auditLog, mexAccounts, users, withdrawals } from '@rb/db';
import { encryptString } from '@rb/crypto';
import { ASSETS, NETWORKS, isSupported, isValidAddress, manualSweepOrderId, type Network } from '@rb/domain';
import { randomUUID } from 'node:crypto';

const SweepSchema = z.object({
  asset: z.enum(ASSETS),
  network: z.enum(NETWORKS),
  address: z.string().min(8),
  amount: z.coerce.number().positive(),
  memo: z.string().optional().nullable(),
});

const RotateSchema = z.object({
  apiKey: z.string().min(8),
  apiSecret: z.string().min(8),
});

const ReassignSchema = z.object({
  newTelegramId: z.coerce.number().int().positive(),
  newTelegramUsername: z.string().optional().nullable(),
});

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    return { ok: false as const, error: 'unauthorized', adminId: '' };
  }
  return { ok: true as const, error: '', adminId: session.user.id };
}

export async function suspendUserAction(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return a;
  await db
    .update(users)
    .set({ status: 'suspended' })
    .where(eq(users.id, userId));
  await db
    .update(mexAccounts)
    .set({ status: 'disabled' })
    .where(eq(mexAccounts.userId, userId));
  await db.insert(auditLog).values({
    actorId: a.adminId,
    action: 'user_suspended',
    targetType: 'user',
    targetId: userId,
  });
  return { ok: true };
}

export async function reactivateUserAction(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return a;
  await db
    .update(users)
    .set({ status: 'approved', deletedAt: null })
    .where(eq(users.id, userId));
  await db
    .update(mexAccounts)
    .set({ status: 'active' })
    .where(eq(mexAccounts.userId, userId));
  await db.insert(auditLog).values({
    actorId: a.adminId,
    action: 'user_reactivated',
    targetType: 'user',
    targetId: userId,
  });
  return { ok: true };
}

export async function rotateApiKeysAction(
  userId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return a;
  const parsed = RotateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };

  const apiKeyEnc = encryptString(parsed.data.apiKey, process.env.MASTER_ENCRYPTION_KEY ?? '');
  const apiSecretEnc = encryptString(parsed.data.apiSecret, process.env.MASTER_ENCRYPTION_KEY ?? '');

  await db
    .update(mexAccounts)
    .set({ apiKeyEnc, apiSecretEnc, status: 'active', updatedAt: new Date() })
    .where(eq(mexAccounts.userId, userId));

  await db.insert(auditLog).values({
    actorId: a.adminId,
    action: 'api_keys_rotated',
    targetType: 'mex_account',
    targetId: userId,
  });
  return { ok: true };
}

export async function manualSweepAction(
  userId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return a;

  const parsed = SweepSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  const d = parsed.data;
  if (!isSupported(d.asset, d.network)) return { ok: false, error: 'pair no soportada' };
  if (!isValidAddress(d.network as Network, d.address)) return { ok: false, error: 'direccion invalida' };

  const mex = await db.query.mexAccounts.findFirst({ where: eq(mexAccounts.userId, userId) });
  if (!mex) return { ok: false, error: 'usuario sin cuenta de exchange vinculada' };

  const actionId = randomUUID();
  // Insert withdrawal in 'pending' status; the worker reconciliation loop or a dedicated
  // manual-sweep handler picks it up. To keep things simple, we insert the withdrawal
  // and rely on the worker's reconciliation to verify it landed; the actual MEX call
  // is done synchronously here so we get immediate feedback.
  try {
    await db.insert(withdrawals).values({
      userId,
      mexAccountId: mex.id,
      type: 'manual_sweep',
      asset: d.asset,
      network: d.network,
      address: d.address,
      memo: d.memo ?? null,
      amount: String(d.amount),
      withdrawOrderId: manualSweepOrderId(actionId),
      status: 'pending',
    });
    await db.insert(auditLog).values({
      actorId: a.adminId,
      action: 'manual_sweep_requested',
      targetType: 'user',
      targetId: userId,
      payload: { asset: d.asset, network: d.network, amount: d.amount, address: d.address },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // Note: actual MEX call is performed by the worker (manual-sweep dispatcher).
  // For Phase 6 we enqueue it; the worker handles execution via the same idempotent
  // withdraw path as user_payouts.
  return { ok: true };
}

export async function reassignTelegramAction(
  userId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return a;
  const parsed = ReassignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };

  try {
    await db
      .update(users)
      .set({
        telegramId: parsed.data.newTelegramId,
        telegramUsername: parsed.data.newTelegramUsername ?? null,
      })
      .where(eq(users.id, userId));
    await db.insert(auditLog).values({
      actorId: a.adminId,
      action: 'telegram_reassigned',
      targetType: 'user',
      targetId: userId,
      payload: { newTelegramId: parsed.data.newTelegramId },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}
