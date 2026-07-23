import 'server-only';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { decryptString } from '@rb/crypto';
import { admin2fa, users } from '@rb/db';
import { eq } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';

export interface RevalidatedAdmin {
  id: string;
  email: string | null;
}

export async function requireRevalidatedAdmin(): Promise<RevalidatedAdmin> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('No autorizado');

  const row = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, googleEmail: true, role: true, status: true, deletedAt: true },
  });
  if (!row || row.role !== 'admin' || row.status !== 'approved' || row.deletedAt) {
    throw new Error('La sesión de administrador ya no es válida');
  }
  return { id: row.id, email: row.googleEmail ?? session.user.email ?? null };
}

export async function requireAdminTotp(code: string): Promise<RevalidatedAdmin> {
  const admin = await requireRevalidatedAdmin();
  if (!/^\d{6}$/.test(code.trim())) throw new Error('Ingresá un código TOTP de 6 dígitos');

  const enrollment = await db.query.admin2fa.findFirst({
    where: eq(admin2fa.userId, admin.id),
  });
  if (!enrollment?.enabled) throw new Error('El administrador debe habilitar 2FA');

  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey) throw new Error('MASTER_ENCRYPTION_KEY no está configurada');
  const secret = decryptString(Buffer.from(enrollment.totpSecretEnc, 'base64'), masterKey);
  const totp = new OTPAuth.TOTP({
    issuer: 'Robobounce',
    label: admin.email ?? admin.id,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  if (totp.validate({ token: code.trim(), window: 1 }) === null) {
    throw new Error('Código TOTP inválido');
  }
  return admin;
}
