'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLog, invitations, mexAccounts, users } from '@rb/db';
import { encryptString, urlSafeToken } from '@rb/crypto';
import { auth } from '@/auth';
import { sendNotification } from '@/lib/notifications';
import { env } from '@/lib/env';

const INVITATION_TTL_HOURS = 48;

export async function approveUserAction(
  userId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    return { ok: false, error: 'unauthorized' };
  }

  const mexEmail = String(formData.get('mexEmail') ?? '').trim();
  const apiKey = String(formData.get('apiKey') ?? '').trim();
  const apiSecret = String(formData.get('apiSecret') ?? '').trim();
  const ipWhitelisted = String(formData.get('ipWhitelisted') ?? 'no');

  if (!mexEmail || !apiKey || !apiSecret) {
    return { ok: false, error: 'todos los campos son obligatorios' };
  }

  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) return { ok: false, error: 'usuario no existe' };

  const apiKeyEnc = encryptString(apiKey, process.env.MASTER_ENCRYPTION_KEY ?? '');
  const apiSecretEnc = encryptString(apiSecret, process.env.MASTER_ENCRYPTION_KEY ?? '');

  const token = urlSafeToken(32);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(mexAccounts)
        .values({
          userId,
          mexEmail,
          apiKeyEnc,
          apiSecretEnc,
          ipWhitelisted,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: mexAccounts.userId,
          set: { mexEmail, apiKeyEnc, apiSecretEnc, ipWhitelisted, status: 'active' },
        });

      await tx
        .update(users)
        .set({
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: session.user.id,
        })
        .where(eq(users.id, userId));

      await tx.insert(invitations).values({ userId, token, expiresAt });

      await tx.insert(auditLog).values({
        actorId: session.user.id,
        action: 'approve_user',
        targetType: 'user',
        targetId: userId,
        payload: { mexEmail, ipWhitelisted, invitationId: 'created' },
      });
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Send invitation link via Telegram
  if (target.telegramId) {
    const link = `${env.NEXTAUTH_URL}/i/${token}`;
    await sendNotification({
      userId,
      chatId: String(target.telegramId),
      type: 'admin_alert',
      text: `Tu cuenta fue aprobada. Ingresa con Google desde este link (valido 48hs):\n\n${link}`,
    });
  }

  return { ok: true };
}

export async function rejectUserAction(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    return { ok: false, error: 'unauthorized' };
  }
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: 'suspended', deletedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.insert(auditLog).values({
        actorId: session.user.id,
        action: 'reject_user',
        targetType: 'user',
        targetId: userId,
      });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
