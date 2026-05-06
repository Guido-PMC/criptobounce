'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { auditLog, destinationWallets, routingRules } from '@rb/db';
import { ASSETS, NETWORKS } from '@rb/domain';

const RuleSchema = z.object({
  id: z.string().uuid().optional(),
  fromAsset: z.string(),
  fromNetwork: z.string(),
  destinationWalletId: z.string().uuid(),
  priority: z.coerce.number().int().min(1).max(1000),
  enabled: z.coerce.boolean(),
});

export async function saveRuleAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const userId = session.user.id;

  const raw: Record<string, unknown> = Object.fromEntries(formData);
  raw.enabled = raw.enabled === '1' || raw.enabled === 'on';

  const parsed = RuleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  const d = parsed.data;

  const fromAsset = d.fromAsset === '*' ? null : d.fromAsset;
  const fromNetwork = d.fromNetwork === '*' ? null : d.fromNetwork;
  if (fromAsset && !ASSETS.includes(fromAsset as (typeof ASSETS)[number])) {
    return { ok: false, error: 'asset invalido' };
  }
  if (fromNetwork && !NETWORKS.includes(fromNetwork as (typeof NETWORKS)[number])) {
    return { ok: false, error: 'red invalida' };
  }

  const wallet = await db.query.destinationWallets.findFirst({
    where: and(eq(destinationWallets.id, d.destinationWalletId), eq(destinationWallets.userId, userId)),
  });
  if (!wallet) return { ok: false, error: 'wallet destino no existe' };

  try {
    if (d.id) {
      await db
        .update(routingRules)
        .set({
          fromAsset,
          fromNetwork,
          destinationWalletId: d.destinationWalletId,
          toAsset: wallet.asset,
          toNetwork: wallet.network,
          priority: d.priority,
          enabled: d.enabled,
        })
        .where(and(eq(routingRules.id, d.id), eq(routingRules.userId, userId)));
    } else {
      await db.insert(routingRules).values({
        userId,
        fromAsset,
        fromNetwork,
        destinationWalletId: d.destinationWalletId,
        toAsset: wallet.asset,
        toNetwork: wallet.network,
        priority: d.priority,
        enabled: d.enabled,
      });
    }
    await db.insert(auditLog).values({
      actorId: userId,
      action: d.id ? 'rule_updated' : 'rule_created',
      targetType: 'routing_rule',
      targetId: d.id ?? null,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

export async function deleteRuleAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  try {
    await db
      .update(routingRules)
      .set({ deletedAt: new Date(), enabled: false })
      .where(and(eq(routingRules.id, id), eq(routingRules.userId, session.user.id)));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
