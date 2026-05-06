export const ASSETS = ['USDT', 'BTC', 'ETH'] as const;
export type Asset = (typeof ASSETS)[number];

export const NETWORKS = ['TRC20', 'ERC20', 'BSC', 'POLYGON', 'ARBITRUM', 'SOL', 'BTC'] as const;
export type Network = (typeof NETWORKS)[number];

export interface AssetNetwork {
  asset: Asset;
  network: Network;
}

export const SUPPORTED_PAIRS: AssetNetwork[] = [
  { asset: 'USDT', network: 'TRC20' },
  { asset: 'USDT', network: 'ERC20' },
  { asset: 'USDT', network: 'BSC' },
  { asset: 'USDT', network: 'POLYGON' },
  { asset: 'USDT', network: 'ARBITRUM' },
  { asset: 'USDT', network: 'SOL' },
  { asset: 'BTC', network: 'BTC' },
  { asset: 'ETH', network: 'ERC20' },
];

export function isSupported(asset: string, network: string): boolean {
  return SUPPORTED_PAIRS.some(
    (p) => p.asset === asset.toUpperCase() && p.network === network.toUpperCase(),
  );
}

/**
 * MEX returns coin/network identifiers in their own format, e.g.:
 *   coin: "USDT-TRX",          network: "Tron(TRC20)"
 *   coin: "USDT-MATIC",        network: "Polygon(MATIC)"
 *   coin: "BTC",               network: "Bitcoin(BTC)"
 *   coin: "ETH",               network: "Ethereum(ERC20)"
 *
 * We need to translate these into our internal {asset, network} shape so the
 * routing rules, fees and minimums work consistently across the codebase.
 *
 * Returns null if the pair is not one we support.
 */
export function mapMexToInternal(rawCoin: string, rawNetwork: string): AssetNetwork | null {
  const coinPrefix = rawCoin.split('-')[0]?.toUpperCase();
  if (!coinPrefix || !ASSETS.includes(coinPrefix as Asset)) return null;
  const asset = coinPrefix as Asset;

  const tag = rawNetwork.toLowerCase();
  const matchers: Array<[Network, string[]]> = [
    ['TRC20', ['trc20', 'tron', 'trx']],
    ['ERC20', ['erc20', 'ethereum']],
    ['BSC', ['bsc', 'bep20', 'bnb']],
    ['POLYGON', ['polygon', 'matic']],
    ['ARBITRUM', ['arbitrum', 'arb']],
    // Solana on MEX shows up as "Solana(SOL)" / coin "USDT-SOL". Match on
    // "solana" first, then bare "sol" as a fallback for older naming.
    ['SOL', ['solana', 'sol']],
    // Match Bitcoin only on substring "bitcoin" — bare "btc" would collide with
    // tickers like "BTCUSDT" if we ever feed something else here.
    ['BTC', ['bitcoin']],
  ];

  for (const [internal, hints] of matchers) {
    if (hints.some((h) => tag.includes(h))) {
      const candidate: AssetNetwork = { asset, network: internal };
      if (isSupported(candidate.asset, candidate.network)) return candidate;
    }
  }
  return null;
}

export function spotSymbol(from: Asset, to: Asset): string | null {
  if (from === to) return null;
  // MEXC uses base+quote without separator. Spot uses USDT as quote when present.
  if (to === 'USDT') return `${from}USDT`;
  if (from === 'USDT') return `${to}USDT`; // sell direction handled by caller
  return null;
}
