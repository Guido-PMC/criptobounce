import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../index';
import { platformCommissions, userCommissions } from '../schema/index';

/**
 * Mirror of `CommissionConfig` from `@rb/domain`; redeclared here so this
 * package does not need a hard dep on `@rb/domain` (would create a cycle:
 * db -> domain, domain -> nothing currently).
 */
export interface CommissionConfig {
  percent: number;
  fixed: number;
}

/**
 * Returns the commission config that applies to a (user, asset) pair. Prefers
 * an asset-specific row, falls back to the wildcard '*' row, and finally to a
 * zero-config so callers do not have to null-check.
 */
export async function getUserCommission(
  db: Database,
  userId: string,
  asset: string,
): Promise<CommissionConfig> {
  const rows = await db
    .select()
    .from(userCommissions)
    .where(and(eq(userCommissions.userId, userId), inArray(userCommissions.asset, [asset, '*'])));

  const specific = rows.find((r) => r.asset === asset);
  const fallback = rows.find((r) => r.asset === '*');
  const chosen = specific ?? fallback;
  return {
    percent: Number(chosen?.percent ?? 0),
    fixed: Number(chosen?.fixedAmount ?? 0),
  };
}

/**
 * Returns the platform-side commission for an asset, with the same
 * specific-then-wildcard fallback chain as user commissions.
 */
export async function getPlatformCommission(
  db: Database,
  asset: string,
): Promise<CommissionConfig> {
  const rows = await db
    .select()
    .from(platformCommissions)
    .where(inArray(platformCommissions.asset, [asset, '*']));
  const specific = rows.find((r) => r.asset === asset);
  const fallback = rows.find((r) => r.asset === '*');
  const chosen = specific ?? fallback;
  return {
    percent: Number(chosen?.percent ?? 0),
    fixed: Number(chosen?.fixedAmount ?? 0),
  };
}
