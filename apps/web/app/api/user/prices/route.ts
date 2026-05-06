import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { getPlatformCommission, getUserCommission } from '@rb/db';
import {
  applyCommissionToQuote,
  PRICEABLE_ASSETS,
  usdtSpotSymbol,
} from '@rb/domain';
import { fetchBookTickers } from '@rb/mex-client';

export const dynamic = 'force-dynamic';

interface PriceItem {
  asset: string;
  symbol: string;
  compra: number;
  venta: number;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const symbols: string[] = [];
  const assetForSymbol = new Map<string, string>();
  for (const asset of PRICEABLE_ASSETS) {
    const sym = usdtSpotSymbol(asset);
    if (!sym) continue;
    symbols.push(sym);
    assetForSymbol.set(sym, asset);
  }

  let tickers: Awaited<ReturnType<typeof fetchBookTickers>>;
  try {
    tickers = await fetchBookTickers(symbols, { timeoutMs: 4000 });
  } catch {
    return NextResponse.json(
      { error: 'pricing_unavailable', items: [] },
      { status: 502 },
    );
  }

  const items: PriceItem[] = [];
  for (const t of tickers) {
    const asset = assetForSymbol.get(t.symbol);
    if (!asset) continue;
    const [user, platform] = await Promise.all([
      getUserCommission(db, userId, asset),
      getPlatformCommission(db, asset),
    ]);
    const { compra, venta } = applyCommissionToQuote(
      { bid: t.bid, ask: t.ask },
      user,
      platform,
    );
    items.push({ asset, symbol: t.symbol, compra, venta });
  }

  return NextResponse.json(
    {
      ts: new Date().toISOString(),
      items,
    },
    {
      headers: {
        // Browsers should never cache; the page itself polls every 60s.
        'Cache-Control': 'no-store, must-revalidate',
      },
    },
  );
}
