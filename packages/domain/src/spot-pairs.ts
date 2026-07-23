export interface SpotPairCandidate {
  symbol: string;
  side: 'BUY' | 'SELL';
  baseAsset: string;
  quoteAsset: string;
}

export function candidateSpotPairs(fromInput: string, toInput: string): SpotPairCandidate[] {
  const from = fromInput.trim().toUpperCase();
  const to = toInput.trim().toUpperCase();
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
