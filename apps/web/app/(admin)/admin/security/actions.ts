'use server';

import { eq } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { admin2fa, auditLog } from '@rb/db';
import { encryptString, decryptString } from '@rb/crypto';

const ISSUER = 'Robobounce';

function masterKey(): string {
  return process.env.MASTER_ENCRYPTION_KEY ?? '';
}

export async function generate2FAAction(
  email: string,
): Promise<
  { ok: true; otpauth: string; qrDataUrl: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') return { ok: false, error: 'unauthorized' };

  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email || session.user.id,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const otpauth = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(otpauth, { width: 240 });

  const enc = encryptString(secret.base32, masterKey()).toString('base64');
  await db
    .insert(admin2fa)
    .values({ userId: session.user.id, totpSecretEnc: enc, enabled: false })
    .onConflictDoUpdate({
      target: admin2fa.userId,
      set: { totpSecretEnc: enc, enabled: false },
    });

  return { ok: true, otpauth, qrDataUrl };
}

export async function verify2FAAction(
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };

  const row = await db.query.admin2fa.findFirst({ where: eq(admin2fa.userId, session.user.id) });
  if (!row) return { ok: false, error: 'no enrollment in progress' };

  const secret = decryptString(Buffer.from(row.totpSecretEnc, 'base64'), masterKey());
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: session.user.email ?? session.user.id,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return { ok: false, error: 'codigo invalido' };

  await db
    .update(admin2fa)
    .set({ enabled: true })
    .where(eq(admin2fa.userId, session.user.id));

  await db.insert(auditLog).values({
    actorId: session.user.id,
    action: '2fa_enabled',
    targetType: 'user',
    targetId: session.user.id,
  });
  return { ok: true };
}

export async function disable2FAAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };

  await db.delete(admin2fa).where(eq(admin2fa.userId, session.user.id));
  await db.insert(auditLog).values({
    actorId: session.user.id,
    action: '2fa_disabled',
    targetType: 'user',
    targetId: session.user.id,
  });
  return { ok: true };
}
