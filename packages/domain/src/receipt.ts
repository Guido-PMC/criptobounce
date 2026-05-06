import type { Asset } from './assets';

export type ReceiptSide = 'BUY' | 'SELL';

/**
 * Maximum cosmetic spread allowed. We cap to 50% so a misconfigured slider
 * can never make the displayed amount-out negative or zero. The UI exposes a
 * much smaller range (0..5%) but defense-in-depth is cheap here.
 */
export const MAX_RECEIPT_SPREAD = 0.5;

export function clampReceiptSpread(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct <= 0) return 0;
  if (pct >= MAX_RECEIPT_SPREAD) return MAX_RECEIPT_SPREAD;
  return pct;
}

/**
 * Determines whether the user is, from their counterparty's point of view,
 * "buying" the non-USDT asset (USDT in, BTC/ETH out) or "selling" it
 * (BTC/ETH in, USDT out). Returns null when no clear side applies (same asset
 * on both ends, or neither side is USDT).
 */
export function receiptSide(assetIn: string, assetOut: string): ReceiptSide | null {
  if (assetIn === assetOut) return null;
  if (assetIn === 'USDT' && assetOut !== 'USDT') return 'BUY';
  if (assetOut === 'USDT' && assetIn !== 'USDT') return 'SELL';
  return null;
}

/**
 * Picks which of (assetIn, assetOut) is the non-USDT side. The receipt always
 * quotes the price as "USDT per <crypto>" so we need the crypto label.
 */
export function receiptCryptoAsset(assetIn: string, assetOut: string): string | null {
  if (assetIn !== 'USDT' && assetOut === 'USDT') return assetIn;
  if (assetOut !== 'USDT' && assetIn === 'USDT') return assetOut;
  return null;
}

export interface RealConversion {
  /** Real amount the user deposited (in assetIn units). */
  amountIn: number;
  /**
   * Real amount on the OUT side of the operation. Receipt v1 used the raw
   * conversion output (pre-commission); receipt v2 uses the amount actually
   * sent on-chain to the destination wallet, so the receipt's math closes
   * the loop with what the counterparty observes.
   */
  realAmountOut: number;
  /** Side from the user's counterparty perspective. */
  side: ReceiptSide;
}

export interface ReceiptDisplay {
  /**
   * Cosmetic exchange rate, always quoted as USDT per non-USDT unit. Already
   * shifted by the spread (worse than market for the receipt's recipient).
   */
  displayedRateUsdtPerUnit: number;
  /** Real, unmodified rate USDT per non-USDT unit (for internal/debug use). */
  realRateUsdtPerUnit: number;
  /** Amount-in shown on the receipt; identical to the real amount-in. */
  displayedAmountIn: number;
  /**
   * Amount-out shown on the receipt. Derived from `displayedRate × amountIn`
   * for sells, or `amountIn / displayedRate` for buys. Different from the
   * real on-chain amount because of the cosmetic spread.
   */
  displayedAmountOut: number;
}

/**
 * Computes the cosmetic numbers shown on the receipt from a real conversion
 * plus a (snapshotted) spread percent. The actual on-chain amounts are NOT
 * touched; this is purely for rendering.
 *
 * - On SELL the user (operator) is "buying" crypto from their counterparty
 *   to credit USDT downstream, so we show the counterparty fewer USDT per
 *   unit (rate × (1 - spread)).
 * - On BUY the operator is "selling" crypto to their counterparty, so we
 *   show more USDT per unit (rate × (1 + spread)).
 */
export function computeReceiptDisplay(
  conv: RealConversion,
  spreadPct: number,
): ReceiptDisplay {
  const spread = clampReceiptSpread(spreadPct);
  const safeIn = conv.amountIn > 0 ? conv.amountIn : 0;
  const safeOut = conv.realAmountOut > 0 ? conv.realAmountOut : 0;

  let realRate: number;
  if (conv.side === 'SELL') {
    // assetIn is crypto, assetOut is USDT
    realRate = safeIn > 0 ? safeOut / safeIn : 0;
  } else {
    // BUY: assetIn is USDT, assetOut is crypto
    realRate = safeOut > 0 ? safeIn / safeOut : 0;
  }

  const direction = conv.side === 'SELL' ? -1 : 1;
  const displayedRate = realRate * (1 + direction * spread);

  let displayedAmountOut: number;
  if (conv.side === 'SELL') {
    displayedAmountOut = safeIn * displayedRate;
  } else {
    displayedAmountOut = displayedRate > 0 ? safeIn / displayedRate : 0;
  }

  return {
    displayedRateUsdtPerUnit: displayedRate,
    realRateUsdtPerUnit: realRate,
    displayedAmountIn: safeIn,
    displayedAmountOut,
  };
}

/**
 * Returns whether a (assetIn, assetOut) pair should produce an operation
 * receipt. Today we only render receipts for actual conversions where one
 * side is USDT (the only spot pairs the bouncer trades).
 */
export function isReceiptEligible(assetIn: string, assetOut: string): boolean {
  return receiptSide(assetIn, assetOut) !== null;
}

/** Decimal precision for display. Crypto units get 8 dp, USDT gets 2. */
export function receiptDecimals(asset: Asset | string): number {
  return asset === 'USDT' ? 2 : 8;
}
