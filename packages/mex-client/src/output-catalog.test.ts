import { describe, expect, it } from 'vitest';
import { buildMexOutputCatalog, selectMexOutputNetwork } from './output-catalog';
import type { MexCapitalConfigEntry, MexExchangeInfo } from './types';

const exchangeInfo: MexExchangeInfo = {
  symbols: [
    { symbol: 'BTCUSDT', status: '1', baseAsset: 'BTC', quoteAsset: 'USDT' },
    { symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT' },
    { symbol: 'AAAUSDT', status: 'ENABLED', baseAsset: 'AAA', quoteAsset: 'USDT' },
    { symbol: 'BADUSDT', status: 'BREAK', baseAsset: 'BAD', quoteAsset: 'USDT' },
    { symbol: 'USDTUSDC', status: '1', baseAsset: 'USDT', quoteAsset: 'USDC' },
  ],
};

function capitalEntry(
  coin: string,
  options: { enabled?: boolean; fee?: string | null; min?: string | null } = {},
): MexCapitalConfigEntry {
  return {
    coin,
    name: coin,
    networkList: [
      {
        coin,
        network: `${coin}-NET`,
        name: `${coin} Network`,
        withdrawEnable: options.enabled ?? true,
        depositEnable: true,
        withdrawFee: options.fee === undefined ? '0.1' : options.fee,
        withdrawMin: options.min === undefined ? '1' : options.min,
      },
    ],
  };
}

describe('buildMexOutputCatalog', () => {
  it('prioritizes stablecoins and major assets before alphabetical results', () => {
    const catalog = buildMexOutputCatalog('USDT', exchangeInfo, [
      capitalEntry('AAA'),
      capitalEntry('ETH'),
      capitalEntry('BTC'),
      capitalEntry('USDT'),
      capitalEntry('USDC'),
    ]);

    expect(catalog.map((item) => item.asset)).toEqual(['USDT', 'USDC', 'BTC', 'ETH', 'AAA']);
    expect(catalog.find((item) => item.asset === 'BTC')).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
    });
  });

  it('excludes inactive pairs and assets without usable withdrawal networks', () => {
    const catalog = buildMexOutputCatalog('USDT', exchangeInfo, [
      capitalEntry('USDT'),
      capitalEntry('AAA', { enabled: false }),
      capitalEntry('BAD'),
      capitalEntry('ETH', { fee: null }),
      capitalEntry('BTC', { min: null }),
    ]);

    expect(catalog.map((item) => item.asset)).toEqual(['USDT']);
  });

  it('preserves MEX address and memo requirements and resolves legacy network labels', () => {
    const btc = capitalEntry('BTC');
    btc.networkList[0]!.network = 'Bitcoin(BTC)';
    btc.networkList[0]!.addressRegex = '^(bc1|1|3)';
    btc.networkList[0]!.memoRegex = '^\\d+$';
    btc.networkList[0]!.isTag = true;
    const output = buildMexOutputCatalog('USDT', exchangeInfo, [capitalEntry('USDT'), btc]).find(
      (item) => item.asset === 'BTC',
    );

    expect(output?.networks[0]).toMatchObject({
      addressRegex: '^(bc1|1|3)',
      memoRegex: '^\\d+$',
      memoRequired: true,
    });
    expect(output && selectMexOutputNetwork(output, 'BTC', 'BTC')?.mexNetwork).toBe('Bitcoin(BTC)');
  });
});
