'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { auditLog, platformCommissions, systemSettings, telegramMessages } from '@rb/db';
import type { MaintenanceModeValue } from '@rb/db';
import { env as webEnv } from '@/lib/env';

const MaintSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
  scheduleHours: z.number().int().positive().optional(),
});

export async function setMaintenanceAction(input: {
  enabled: boolean;
  reason?: string;
  scheduleHours?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') return { ok: false, error: 'unauthorized' };

  const parsed = MaintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };

  const value: MaintenanceModeValue = {
    enabled: parsed.data.enabled,
    reason: parsed.data.reason,
    startedAt: parsed.data.enabled ? new Date().toISOString() : undefined,
    scheduledUntil: parsed.data.scheduleHours
      ? new Date(Date.now() + parsed.data.scheduleHours * 3600_000).toISOString()
      : null,
  };

  await db
    .insert(systemSettings)
    .values({ key: 'maintenance_mode', value, updatedBy: session.user.id })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedBy: session.user.id, updatedAt: new Date() },
    });

  await db.insert(auditLog).values({
    actorId: session.user.id,
    action: parsed.data.enabled ? 'maintenance_on' : 'maintenance_off',
    targetType: 'system_settings',
    targetId: null,
    payload: value as object,
  });

  // Notify admin via Telegram queue (will be picked up by bot outbound loop)
  try {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChatId) {
      await db.insert(telegramMessages).values({
        chatId: String(adminChatId),
        direction: 'out',
        type: 'admin_alert',
        rawPayload: {
          text: parsed.data.enabled
            ? `Modo mantenimiento ACTIVADO. Motivo: ${parsed.data.reason ?? '-'}`
            : 'Modo mantenimiento DESACTIVADO.',
        },
        sentOk: null,
      });
    }
  } catch {
    /* notif best-effort */
  }

  return { ok: true };
}

const PlatComm = z.object({
  asset: z.string().min(1),
  percent: z.coerce.number().min(0).max(1),
  fixedAmount: z.coerce.number().min(0),
});

export async function savePlatformCommissionAction(input: {
  asset: string;
  percent: string;
  fixedAmount: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') return { ok: false, error: 'unauthorized' };
  const parsed = PlatComm.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };

  await db
    .insert(platformCommissions)
    .values({
      asset: parsed.data.asset,
      percent: parsed.data.percent.toString(),
      fixedAmount: parsed.data.fixedAmount.toString(),
      updatedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: platformCommissions.asset,
      set: {
        percent: parsed.data.percent.toString(),
        fixedAmount: parsed.data.fixedAmount.toString(),
        updatedBy: session.user.id,
        updatedAt: new Date(),
      },
    });

  await db.insert(auditLog).values({
    actorId: session.user.id,
    action: 'platform_commission_updated',
    targetType: 'platform_commission',
    targetId: null,
    payload: { asset: parsed.data.asset, percent: parsed.data.percent, fixed: parsed.data.fixedAmount },
  });
  return { ok: true };
}
