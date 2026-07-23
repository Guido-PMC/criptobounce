import type { MexCapitalConfigEntry, MexClient } from '@rb/mex-client';

/**
 * Map our internal network code (TRC20, ERC20, ...) to the MEX network identifier
 * present in /capital/config/getall.networkList[].network. The exact string varies
 * per coin and per MEX update, so we match by substring instead of hardcoding.
 *
 * MEX returns coins like "USDT-TRX" / "USDT-MATIC" depending on the chain.
 * For deposit-address & withdraw endpoints, MEX expects exactly the values
 * returned by getCapitalConfig.
 */
const NETWORK_HINTS: Record<string, string[]> = {
  TRC20: ['trx', 'trc20', 'tron'],
  ERC20: ['erc20', 'eth_erc20', 'ethereum'],
  BSC: ['bsc', 'bep20', 'bnb smart chain', 'bep-20'],
  POLYGON: ['polygon', 'matic'],
  ARBITRUM: ['arb', 'arbitrum'],
  SOL: ['solana', 'sol'],
  BTC: ['bitcoin'],
};

export interface ResolvedMexNetwork {
  coin: string;
  network: string;
  /** Live withdraw fee from MEX, in `coin` units. Null when MEX didn't expose it. */
  withdrawFee: number | null;
  withdrawMin: number | null;
  withdrawIntegerMultiple: string | null;
}

export function resolveMexNetwork(
  internalCoin: string,
  internalNetwork: string,
  capital: MexCapitalConfigEntry[],
): ResolvedMexNetwork | null {
  const coinEntry = capital.find((c) => c.coin.toUpperCase() === internalCoin.toUpperCase());
  if (!coinEntry) return null;
  const hints = NETWORK_HINTS[internalNetwork] ?? [internalNetwork.toLowerCase()];
  const candidates = coinEntry.networkList.filter((n) => {
    const tag = (n.network ?? '').toLowerCase();
    return hints.some((h) => tag.includes(h));
  });
  if (candidates.length === 0) return null;
  // Prefer entries with deposits/withdraws enabled (depending on context the caller
  // can decide; we just pick the first enabled one or fall back to any).
  const enabled =
    candidates.find((n) => n.depositEnable !== false || n.withdrawEnable !== false) ??
    candidates[0];
  if (!enabled) return null;
  return {
    coin: coinEntry.coin,
    network: enabled.network,
    withdrawFee: parseOptionalNumber(enabled.withdrawFee),
    withdrawMin: parseOptionalNumber(enabled.withdrawMin),
    withdrawIntegerMultiple: enabled.withdrawIntegerMultiple ?? null,
  };
}

export function resolveSnapshottedMexNetwork(
  mexCoin: string,
  mexNetwork: string,
  capital: MexCapitalConfigEntry[],
): ResolvedMexNetwork | null {
  const coinEntry = capital.find((entry) => entry.coin === mexCoin);
  const network = coinEntry?.networkList.find(
    (candidate) => candidate.network === mexNetwork && candidate.withdrawEnable === true,
  );
  if (!coinEntry || !network) return null;
  return {
    coin: coinEntry.coin,
    network: network.network,
    withdrawFee: parseOptionalNumber(network.withdrawFee),
    withdrawMin: parseOptionalNumber(network.withdrawMin),
    withdrawIntegerMultiple: network.withdrawIntegerMultiple ?? null,
  };
}

function parseOptionalNumber(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-account, time-bounded cache for `getCapitalConfig`.
 * The capital config is large (~100KB) and changes rarely, so we cache it
 * for 10 minutes per MEX account to avoid hammering MEX on every withdraw.
 */
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; data: MexCapitalConfigEntry[] }>();

export async function getCachedCapitalConfig(
  mexAccountId: string,
  client: MexClient,
): Promise<MexCapitalConfigEntry[]> {
  const cached = cache.get(mexAccountId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.data;
  }
  const data = await client.getCapitalConfig();
  cache.set(mexAccountId, { fetchedAt: Date.now(), data });
  return data;
}

export function invalidateCapitalConfigCache(mexAccountId?: string): void {
  if (mexAccountId) cache.delete(mexAccountId);
  else cache.clear();
}
