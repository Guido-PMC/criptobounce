import { describe, expect, it } from 'vitest';
import { candidateSpotPairs } from './spot-pairs';

describe('candidateSpotPairs', () => {
  it('returns direct sell before reverse buy', () => {
    expect(candidateSpotPairs('BTC', 'USDC')).toEqual([
      { symbol: 'BTCUSDC', side: 'SELL', baseAsset: 'BTC', quoteAsset: 'USDC' },
      { symbol: 'USDCBTC', side: 'BUY', baseAsset: 'USDC', quoteAsset: 'BTC' },
    ]);
  });

  it('returns no conversion for the same asset', () => {
    expect(candidateSpotPairs('USDT', 'USDT')).toEqual([]);
  });
});
