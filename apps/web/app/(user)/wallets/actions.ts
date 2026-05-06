'use server';

import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { auditLog, destinationWallets } from '@rb/db';
import { isValidAddress, type Network, NETWORKS, ASSETS, isSupported } from '@rb/domain';

const WalletSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(80),
  asset: z.enum(ASSETS),
  network: z.enum(NETWORKS),
  address: z.string().min(8).max(120),
  memo: z.string().max(80).optional().nullable(),
  isDefault: z.coerce.boolean(),
});

export async function saveWalletAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const userId = session.user.id;

  const raw: Record<string, unknown> = Object.fromEntries(formData);
  if (raw.isDefault === '1' || raw.isDefault === 'on') raw.isDefault = true;
  else raw.isDefault = false;

  const parsed = WalletSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const data = parsed.data;

  if (!isSupported(data.asset, data.network)) {
    return { ok: false, error: `combinacion ${data.asset}-${data.network} no soportada` };
  }
  if (!isValidAddress(data.network as Network, data.address)) {
    return { ok: false, error: `direccion invalida para ${data.network}` };
  }

  try {
    await db.transaction(async (tx) => {
      if (data.isDefault) {
        // Clear other defaults for the same asset/network
        await tx
          .update(destinationWallets)
          .set({ isDefault: false })
          .where(
            and(
              eq(destinationWallets.userId, userId),
              eq(destinationWallets.asset, data.asset),
              eq(destinationWallets.network, data.network),
              isNull(destinationWallets.deletedAt),
              data.id ? ne(destinationWallets.id, data.id) : undefined,
            ),
          );
      }

      if (data.id) {
        await tx
          .update(destinationWallets)
          .set({
            label: data.label,
            asset: data.asset,
            network: data.network,
            address: data.address,
            memo: data.memo ?? null,
            isDefault: data.isDefault,
          })
          .where(and(eq(destinationWallets.id, data.id), eq(destinationWallets.userId, userId)));
      } else {
        await tx.insert(destinationWallets).values({
          userId,
          label: data.label,
          asset: data.asset,
          network: data.network,
          address: data.address,
          memo: data.memo ?? null,
          isDefault: data.isDefault,
        });
      }

      await tx.insert(auditLog).values({
        actorId: userId,
        action: data.id ? 'wallet_updated' : 'wallet_created',
        targetType: 'destination_wallet',
        targetId: data.id ?? null,
        payload: { asset: data.asset, network: data.network, isDefault: data.isDefault },
      });
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

export async function deleteWalletAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const userId = session.user.id;

  try {
    await db
      .update(destinationWallets)
      .set({ deletedAt: new Date(), isDefault: false })
      .where(and(eq(destinationWallets.id, id), eq(destinationWallets.userId, userId)));

    await db.insert(auditLog).values({
      actorId: userId,
      action: 'wallet_deleted',
      targetType: 'destination_wallet',
      targetId: id,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}
