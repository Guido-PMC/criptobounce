import 'server-only';

import { db } from '@/lib/db';
import { getPlatformCommission, getUserCommission } from '@rb/db';
import { type ManualQuoteCalculation, candidateSpotPairs } from '@rb/domain';
import { MexClient, fetchBookTickers } from '@rb/mex-client';

export interface ManualMarketQuote {
  symbol: string | null;
  side: 'BUY' | 'SELL' | null;
  price: number;
}

function isTradableStatus(status: string | undefined): boolean {
  return status !== undefined && ['1', 'TRADING', 'ENABLED'].includes(status.toUpperCase());
}

export async function resolveFreshManualQuote(
  from: string,
  to: string,
): Promise<ManualMarketQuote> {
  if (from === to) return { symbol: null, side: null, price: 1 };
  const client = new MexClient({ apiKey: '', apiSecret: '' });
  for (const candidate of candidateSpotPairs(from, to)) {
    const info = await client.getSymbolInfo(candidate.symbol);
    if (!info || info.symbol !== candidate.symbol || !isTradableStatus(info.status)) continue;
    const [ticker] = await fetchBookTickers([candidate.symbol], { timeoutMs: 4_000 });
    if (!ticker || ticker.symbol !== candidate.symbol) continue;
    return {
      symbol: candidate.symbol,
      side: candidate.side,
      price: candidate.side === 'SELL' ? ticker.bid : ticker.ask,
    };
  }
  throw new Error(`No hay un mercado MEX directo habilitado para ${from}/${to}`);
}

export async function loadManualQuoteCalculation(
  userId: string,
  fromAsset: string,
  toAsset: string,
  networkFee: string | number,
): Promise<{ quote: ManualMarketQuote; calculation: ManualQuoteCalculation }> {
  const [quote, userCommission, platformCommission] = await Promise.all([
    resolveFreshManualQuote(fromAsset, toAsset),
    getUserCommission(db, userId, toAsset),
    getPlatformCommission(db, toAsset),
  ]);
  return {
    quote,
    calculation: {
      price: quote.price,
      side: quote.side,
      userCommission,
      platformCommission,
      networkFee,
    },
  };
}
