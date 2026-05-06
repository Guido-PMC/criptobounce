import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@rb/db';
import { platformCommissions, userCommissions } from '@rb/db';
import type { CommissionConfig } from '@rb/domain';

export async function getUserCommission(
  db: Database,
  userId: string,
  asset: string,
): Promise<CommissionConfig> {
  const rows = await db
    .select()
    .from(userCommissions)
    .where(and(eq(userCommissions.userId, userId), inArray(userCommissions.asset, [asset, '*'])));

  // Prefer asset-specific
  const specific = rows.find((r) => r.asset === asset);
  const fallback = rows.find((r) => r.asset === '*');
  const chosen = specific ?? fallback;
  return {
    percent: Number(chosen?.percent ?? 0),
    fixed: Number(chosen?.fixedAmount ?? 0),
  };
}

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
