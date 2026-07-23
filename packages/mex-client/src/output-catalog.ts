import type { MexCapitalConfigEntry, MexExchangeInfo } from './types';

export const PRIORITY_OUTPUT_ASSETS = ['USDT', 'USDC', 'BTC', 'ETH', 'TRX'] as const;

export interface MexOutputNetwork {
  mexCoin: string;
  mexNetwork: string;
  name: string;
  withdrawFee: string;
  withdrawMin: string;
  withdrawIntegerMultiple: string | null;
  addressRegex: string | null;
  memoRegex: string | null;
  memoRequired: boolean;
}

export interface MexOutputAsset {
  asset: string;
  name: string;
  symbol: string | null;
  side: 'BUY' | 'SELL' | null;
  networks: MexOutputNetwork[];
}

function isTradableStatus(status: string | undefined): boolean {
  return status !== undefined && ['1', 'TRADING', 'ENABLED'].includes(status.toUpperCase());
}

function isFiniteDecimal(value: string | null | undefined): value is string {
  if (value === null || value === undefined || value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

function assetRank(asset: string): number {
  const rank = PRIORITY_OUTPUT_ASSETS.indexOf(asset as (typeof PRIORITY_OUTPUT_ASSETS)[number]);
  return rank === -1 ? PRIORITY_OUTPUT_ASSETS.length : rank;
}

function mexFlagEnabled(value: boolean | number | string | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'required'].includes(value?.toLowerCase() ?? '');
}

export function buildMexOutputCatalog(
  fromAssetInput: string,
  exchangeInfo: MexExchangeInfo,
  capital: MexCapitalConfigEntry[],
): MexOutputAsset[] {
  const fromAsset = fromAssetInput.trim().toUpperCase();
  const pairs = new Map<
    string,
    { symbol: string; side: 'BUY' | 'SELL'; baseAsset: string; quoteAsset: string }
  >();

  for (const info of exchangeInfo.symbols) {
    if (!isTradableStatus(info.status) || !info.baseAsset || !info.quoteAsset) continue;
    const baseAsset = info.baseAsset.toUpperCase();
    const quoteAsset = info.quoteAsset.toUpperCase();
    if (baseAsset === fromAsset && quoteAsset !== fromAsset) {
      pairs.set(quoteAsset, {
        symbol: info.symbol,
        side: 'SELL',
        baseAsset,
        quoteAsset,
      });
    } else if (quoteAsset === fromAsset && baseAsset !== fromAsset) {
      pairs.set(baseAsset, {
        symbol: info.symbol,
        side: 'BUY',
        baseAsset,
        quoteAsset,
      });
    }
  }

  const candidateAssets = new Set([...pairs.keys(), fromAsset]);
  const networksByAsset = new Map<string, MexOutputNetwork[]>();
  const namesByAsset = new Map<string, string>();

  for (const entry of capital) {
    const asset = entry.coin.split('-')[0]?.toUpperCase();
    if (!asset || !candidateAssets.has(asset)) continue;
    namesByAsset.set(asset, entry.name?.trim() || asset);
    const current = networksByAsset.get(asset) ?? [];
    for (const network of entry.networkList) {
      if (
        network.withdrawEnable !== true ||
        !isFiniteDecimal(network.withdrawFee) ||
        !isFiniteDecimal(network.withdrawMin)
      ) {
        continue;
      }
      const mexNetwork = network.network.trim();
      if (!mexNetwork) continue;
      const candidate: MexOutputNetwork = {
        mexCoin: entry.coin,
        mexNetwork,
        name: network.name?.trim() || mexNetwork,
        withdrawFee: network.withdrawFee,
        withdrawMin: network.withdrawMin,
        withdrawIntegerMultiple: network.withdrawIntegerMultiple ?? null,
        addressRegex: network.addressRegex?.trim() || null,
        memoRegex: network.memoRegex?.trim() || null,
        memoRequired: mexFlagEnabled(network.isTag) || Boolean(network.memoRegex?.trim()),
      };
      if (
        !current.some(
          (existing) =>
            existing.mexCoin === candidate.mexCoin && existing.mexNetwork === candidate.mexNetwork,
        )
      ) {
        current.push(candidate);
      }
    }
    networksByAsset.set(asset, current);
  }

  return [...candidateAssets]
    .flatMap((asset): MexOutputAsset[] => {
      const networks = networksByAsset.get(asset) ?? [];
      if (networks.length === 0) return [];
      const pair = pairs.get(asset);
      if (asset !== fromAsset && !pair) return [];
      return [
        {
          asset,
          name: namesByAsset.get(asset) ?? asset,
          symbol: pair?.symbol ?? null,
          side: pair?.side ?? null,
          networks: [...networks].sort((left, right) => left.name.localeCompare(right.name)),
        },
      ];
    })
    .sort((left, right) => {
      const rankDelta = assetRank(left.asset) - assetRank(right.asset);
      return rankDelta || left.asset.localeCompare(right.asset);
    });
}

const LEGACY_NETWORK_HINTS: Record<string, string[]> = {
  TRC20: ['trx', 'trc20', 'tron'],
  ERC20: ['erc20', 'eth_erc20', 'ethereum'],
  BSC: ['bsc', 'bep20', 'bnb smart chain', 'bep-20'],
  POLYGON: ['polygon', 'matic'],
  ARBITRUM: ['arb', 'arbitrum'],
  SOL: ['solana', 'sol'],
  BTC: ['bitcoin', 'btc'],
};

export function selectMexOutputNetwork(
  output: MexOutputAsset,
  mexCoin: string,
  mexNetwork: string,
): MexOutputNetwork | undefined {
  const exact = output.networks.find(
    (network) => network.mexCoin === mexCoin && network.mexNetwork === mexNetwork,
  );
  if (exact) return exact;
  if (mexCoin.toUpperCase() !== output.asset) return undefined;
  const hints = LEGACY_NETWORK_HINTS[mexNetwork.toUpperCase()];
  if (!hints) return undefined;
  return output.networks.find((network) => {
    const searchable = `${network.mexNetwork} ${network.name}`.toLowerCase();
    return hints.some((hint) => searchable.includes(hint));
  });
}
