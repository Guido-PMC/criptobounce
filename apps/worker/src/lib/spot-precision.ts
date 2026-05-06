import type { MexClient, MexSymbolInfo } from '@rb/mex-client';

interface CacheEntry {
  info: MexSymbolInfo;
  ts: number;
}

const SYMBOL_CACHE = new Map<string, CacheEntry>();
const SYMBOL_CACHE_TTL_MS = 60 * 60_000;

/**
 * Process-local cache. Spot exchangeInfo is large but rarely changes per
 * symbol, so caching for an hour is plenty and shaves ~150ms off every
 * conversion.
 */
export async function getSpotSymbolInfo(
  client: MexClient,
  symbol: string,
): Promise<MexSymbolInfo | null> {
  const cached = SYMBOL_CACHE.get(symbol);
  if (cached && Date.now() - cached.ts < SYMBOL_CACHE_TTL_MS) return cached.info;

  const info = await client.getSymbolInfo(symbol);
  if (info) SYMBOL_CACHE.set(symbol, { info, ts: Date.now() });
  return info;
}

/**
 * For tests / forced refresh.
 * @internal
 */
export function clearSpotSymbolCache(): void {
  SYMBOL_CACHE.clear();
}

interface LotSizeFilter {
  filterType: 'LOT_SIZE';
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
}

interface MinNotionalFilter {
  filterType: 'MIN_NOTIONAL' | 'NOTIONAL';
  minNotional?: string;
  applyToMarket?: boolean;
  avgPriceMins?: number;
}

/**
 * Returns the number of decimals the BASE asset quantity must respect for
 * spot orders on this symbol. Resolution order:
 *
 *   1. LOT_SIZE filter `stepSize` (most precise).
 *   2. `baseSizePrecision` (modern MEXC field, sometimes "0.000001").
 *   3. `baseAssetPrecision` (integer count, last resort).
 *
 * If nothing is found we conservatively return 6 — the most common ETH/BTC
 * step on MEXC — so we don't end up sending 8-decimal quantities that get
 * rejected with "quantity scale is invalid".
 */
export function baseQuantityDecimals(info: MexSymbolInfo): number {
  const lot = (info.filters ?? []).find(
    (f) => (f as { filterType?: string }).filterType === 'LOT_SIZE',
  ) as LotSizeFilter | undefined;
  if (lot?.stepSize) {
    const step = Number(lot.stepSize);
    if (Number.isFinite(step) && step > 0) return decimalsFromStep(step);
  }

  if (info.baseSizePrecision !== undefined && info.baseSizePrecision !== null) {
    const raw = String(info.baseSizePrecision).trim();
    if (raw.includes('.') || raw.includes('e') || raw.includes('E')) {
      const step = Number(raw);
      if (Number.isFinite(step) && step > 0 && step <= 1) return decimalsFromStep(step);
    } else if (/^\d+$/.test(raw)) {
      // Some MEXC versions return baseSizePrecision as a digit count string.
      return Number(raw);
    }
  }

  if (info.baseAssetPrecision !== undefined) return info.baseAssetPrecision;

  return 6;
}

/**
 * Returns the same metric for the QUOTE side (used for BUY-by-quoteOrderQty
 * orders, e.g. USDT spend). Mirrors `baseQuantityDecimals` semantics.
 */
export function quoteQuantityDecimals(info: MexSymbolInfo): number {
  if (info.quoteAmountPrecision !== undefined && info.quoteAmountPrecision !== null) {
    const raw = String(info.quoteAmountPrecision).trim();
    if (raw.includes('.') || raw.includes('e') || raw.includes('E')) {
      const step = Number(raw);
      if (Number.isFinite(step) && step > 0 && step <= 1) return decimalsFromStep(step);
    } else if (/^\d+$/.test(raw)) {
      return Number(raw);
    }
  }
  if (info.quoteAssetPrecision !== undefined) return info.quoteAssetPrecision;
  if (info.quotePrecision !== undefined) return info.quotePrecision;
  return 2;
}

/**
 * Floor `amount` to the asset's allowed precision and serialize as a fixed
 * decimal string. We FLOOR (not round) so we never accidentally send more
 * than the user actually has on their MEX balance.
 */
export function truncateToDecimals(amount: string | number, decimals: number): string {
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(num) || num <= 0) return '0';
  const safeDecimals = Math.min(Math.max(0, decimals), 18);
  const factor = 10 ** safeDecimals;
  const truncated = Math.floor(num * factor) / factor;
  return truncated.toFixed(safeDecimals);
}

/**
 * Returns the `minNotional` declared by the symbol (in QUOTE units),
 * or null when the symbol doesn't expose one.
 */
export function symbolMinNotional(info: MexSymbolInfo): number | null {
  const notional = (info.filters ?? []).find((f) => {
    const t = (f as { filterType?: string }).filterType;
    return t === 'MIN_NOTIONAL' || t === 'NOTIONAL';
  }) as MinNotionalFilter | undefined;
  if (!notional?.minNotional) return null;
  const n = Number(notional.minNotional);
  return Number.isFinite(n) ? n : null;
}

function decimalsFromStep(step: number): number {
  if (step >= 1) return 0;
  // Use string parsing instead of repeated multiplication to avoid floating
  // point drift (0.1 * 10 != 1 sometimes).
  const s = step.toExponential();
  const [, rawExp] = s.split('e');
  const exp = Number(rawExp);
  if (!Number.isFinite(exp)) return 8;
  return Math.max(0, -exp);
}
