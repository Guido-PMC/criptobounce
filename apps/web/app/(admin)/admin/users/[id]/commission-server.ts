'use server';

import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { auditLog, userCommissions } from '@rb/db';

const Schema = z.object({
  asset: z.string().min(1),
  percent: z.coerce.number().min(0).max(1),
  fixedAmount: z.coerce.number().min(0),
});

export async function fetchUserCommissionsAction(
  userId: string,
): Promise<Array<{ asset: string; percent: string; fixedAmount: string }>> {
  const rows = await db
    .select({
      asset: userCommissions.asset,
      percent: userCommissions.percent,
      fixedAmount: userCommissions.fixedAmount,
    })
    .from(userCommissions)
    .where(eq(userCommissions.userId, userId));
  return rows.map((r) => ({
    asset: r.asset,
    percent: String(r.percent),
    fixedAmount: String(r.fixedAmount),
  }));
}

export async function saveUserCommissionAction(
  userId: string,
  input: { asset: string; percent: string; fixedAmount: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') return { ok: false, error: 'unauthorized' };
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };

  await db
    .insert(userCommissions)
    .values({
      userId,
      asset: parsed.data.asset,
      percent: parsed.data.percent.toString(),
      fixedAmount: parsed.data.fixedAmount.toString(),
      updatedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [userCommissions.userId, userCommissions.asset],
      set: {
        percent: parsed.data.percent.toString(),
        fixedAmount: parsed.data.fixedAmount.toString(),
        updatedBy: session.user.id,
        updatedAt: new Date(),
      },
    });

  await db.insert(auditLog).values({
    actorId: session.user.id,
    action: 'user_commission_updated',
    targetType: 'user_commission',
    targetId: userId,
    payload: { asset: parsed.data.asset, percent: parsed.data.percent, fixedAmount: parsed.data.fixedAmount },
  });
  return { ok: true };
}
