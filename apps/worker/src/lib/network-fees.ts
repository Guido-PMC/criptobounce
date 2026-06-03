import { eq } from 'drizzle-orm';
import type { Database } from '@rb/db';
import { systemSettings, type NetworkFeesValue } from '@rb/db';
import type { MexClient } from '@rb/mex-client';
import { getCachedCapitalConfig, resolveMexNetwork } from './mex-network-resolver';

/**
 * Last-resort defaults if neither MEX nor system_settings have a value. Keep
 * them conservative (slightly above historical reality) so we don't credit a
 * user more than what the wallet will actually receive.
 */
const FALLBACK: NetworkFeesValue = {
  'USDT-TRC20': 1,
  'USDT-ERC20': 8,
  'USDT-BSC': 0.5,
  'USDT-POLYGON': 0.5,
  'USDT-ARBITRUM': 1,
  'USDT-SOL': 1,
  'USDC-ERC20': 8,
  'BTC-BTC': 0.0005,
  'ETH-ERC20': 0.005,
  'TRX-TRC20': 1,
};

/**
 * Reads the seeded `system_settings.network_fees` table. Used as a fallback
 * source when MEX's live data is unavailable.
 */
export async function getNetworkFee(
  db: Database,
  asset: string,
  network: string,
): Promise<number> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, 'network_fees'),
  });
  const fees = (row?.value as NetworkFeesValue | undefined) ?? FALLBACK;
  return fees[`${asset}-${network}`] ?? FALLBACK[`${asset}-${network}`] ?? 0;
}

/**
 * Resolves the network fee MEX is going to charge **right now** for a
 * (asset, network) pair, with three-tier precedence:
 *
 *   1. Live MEX `getCapitalConfig.networkList[].withdrawFee` (cached 10 min).
 *   2. Seeded `system_settings.network_fees` (operator override, if any).
 *   3. Hardcoded FALLBACK constants in this module.
 *
 * Tier 1 is the source of truth - MEX raises/lowers fees occasionally and the
 * seed drifts. We still fall back when MEX is unreachable so a transient API
 * outage doesn't block bounces.
 */
export async function getLiveNetworkFee(
  db: Database,
  client: MexClient,
  mexAccountId: string,
  asset: string,
  network: string,
): Promise<number> {
  try {
    const capital = await getCachedCapitalConfig(mexAccountId, client);
    const resolved = resolveMexNetwork(asset, network, capital);
    if (resolved && resolved.withdrawFee !== null && resolved.withdrawFee >= 0) {
      return resolved.withdrawFee;
    }
  } catch {
    // ignore - fall through to seeded value
  }
  return getNetworkFee(db, asset, network);
}
