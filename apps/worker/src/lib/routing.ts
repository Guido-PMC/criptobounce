import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { Database, DestinationWallet, RoutingRule } from '@rb/db';
import { destinationWallets, routingRules } from '@rb/db';

export interface RouteResolution {
  rule: RoutingRule;
  wallet: DestinationWallet;
}

/**
 * Resolve which routing rule + destination wallet to use for a given deposit.
 * Selection: enabled rules in priority order; first matching by (asset, network) with
 * NULL acting as wildcard.
 * Falls back to the user's default wallet for the from asset/network if no rule matches.
 */
export async function resolveRoute(
  db: Database,
  userId: string,
  fromAsset: string,
  fromNetwork: string,
): Promise<RouteResolution | null> {
  const rules = await db
    .select()
    .from(routingRules)
    .where(
      and(
        eq(routingRules.userId, userId),
        eq(routingRules.enabled, true),
        isNull(routingRules.deletedAt),
      ),
    )
    .orderBy(asc(routingRules.priority));

  for (const r of rules) {
    const assetOk = r.fromAsset === null || r.fromAsset === fromAsset;
    const networkOk = r.fromNetwork === null || r.fromNetwork === fromNetwork;
    if (!assetOk || !networkOk) continue;

    const wallet = await db.query.destinationWallets.findFirst({
      where: and(eq(destinationWallets.id, r.destinationWalletId), isNull(destinationWallets.deletedAt)),
    });
    if (!wallet) continue;
    return { rule: r, wallet };
  }
  return null;
}
