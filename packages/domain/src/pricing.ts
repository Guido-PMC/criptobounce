import type { Asset } from './assets';
import type { CommissionConfig } from './commission';

export interface PriceQuote {
  bid: number; // raw best bid from market (USDT per asset)
  ask: number; // raw best ask from market (USDT per asset)
}

export interface UserFacingPrice {
  /**
   * Effective USDT per unit of asset when the user BUYS (sends USDT, receives
   * the asset). Higher than `ask` because the percentage commission is
   * subtracted from the asset amount the user receives.
   */
  compra: number;
  /**
   * Effective USDT per unit of asset when the user SELLS (sends asset,
   * receives USDT). Lower than `bid` because the percentage commission is
   * subtracted from the USDT amount the user receives.
   */
  venta: number;
}

/**
 * Hard cap so a misconfigured commission (e.g. 1.5 = 150%) cannot flip the
 * price into nonsense or zero. We cap total percentage at 50%.
 */
const MAX_TOTAL_PCT = 0.5;

/**
 * Combines user + platform percentage commissions and applies them to a raw
 * bid/ask quote. The fixed-amount component is intentionally omitted: it does
 * not translate to a clean per-unit price (depends on transaction size). The
 * fee shown elsewhere on the bounce always reflects the actual deduction.
 */
export function applyCommissionToQuote(
  quote: PriceQuote,
  user: CommissionConfig,
  platform: CommissionConfig,
): UserFacingPrice {
  const rawPct = (user.percent ?? 0) + (platform.percent ?? 0);
  const totalPct = Math.max(0, Math.min(MAX_TOTAL_PCT, rawPct));
  const factor = 1 - totalPct;
  // factor will always be > 0 thanks to MAX_TOTAL_PCT, but guard anyway.
  const safeFactor = factor > 0 ? factor : 1;
  return {
    venta: quote.bid * safeFactor,
    compra: quote.ask / safeFactor,
  };
}

/**
 * Maps an asset to its MEX spot symbol against USDT. Returns null for USDT
 * itself (no price needed) or unsupported assets.
 */
export function usdtSpotSymbol(asset: Asset | string): string | null {
  if (asset === 'USDT') return null;
  return `${asset}USDT`;
}

/**
 * Default ordered list of assets we display prices for. Skips USDT (which
 * has no meaningful self-quoted price).
 */
export const PRICEABLE_ASSETS: Asset[] = ['BTC', 'ETH', 'TRX'];
