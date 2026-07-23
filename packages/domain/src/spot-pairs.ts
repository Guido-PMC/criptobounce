import type { Asset } from './assets';

export interface SpotPairCandidate {
  symbol: string;
  side: 'BUY' | 'SELL';
  baseAsset: Asset;
  quoteAsset: Asset;
}

export function candidateSpotPairs(from: Asset, to: Asset): SpotPairCandidate[] {
  if (from === to) return [];
  return [
    {
      symbol: `${from}${to}`,
      side: 'SELL',
      baseAsset: from,
      quoteAsset: to,
    },
    {
      symbol: `${to}${from}`,
      side: 'BUY',
      baseAsset: to,
      quoteAsset: from,
    },
  ];
}
