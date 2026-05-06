import { eq } from 'drizzle-orm';
import type { Database } from '@rb/db';
import { systemSettings, type MinimumAmountsValue } from '@rb/db';

const FALLBACK: MinimumAmountsValue = { USDT: 5, USDC: 5, BTC: 0.0005, ETH: 0.01 };

export async function getMinimumNet(db: Database, asset: string): Promise<number> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, 'minimum_amounts'),
  });
  const mins = (row?.value as MinimumAmountsValue | undefined) ?? FALLBACK;
  return mins[asset] ?? FALLBACK[asset] ?? 0;
}
