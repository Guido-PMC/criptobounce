import { describe, expect, it } from 'vitest';
import {
  clampReceiptSpread,
  computeReceiptDisplay,
  isReceiptEligible,
  MAX_RECEIPT_SPREAD,
  receiptSide,
} from './receipt';

describe('clampReceiptSpread', () => {
  it('floors negatives, NaN and Infinity to 0', () => {
    expect(clampReceiptSpread(-0.01)).toBe(0);
    expect(clampReceiptSpread(Number.NaN)).toBe(0);
    // Non-finite inputs are treated as "no spread" - safer than capping.
    expect(clampReceiptSpread(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('caps at MAX_RECEIPT_SPREAD', () => {
    expect(clampReceiptSpread(0.99)).toBe(MAX_RECEIPT_SPREAD);
    expect(clampReceiptSpread(0.01)).toBeCloseTo(0.01);
  });
});

describe('receiptSide / isReceiptEligible', () => {
  it('SELL when crypto -> USDT', () => {
    expect(receiptSide('BTC', 'USDT')).toBe('SELL');
    expect(isReceiptEligible('BTC', 'USDT')).toBe(true);
  });

  it('BUY when USDT -> crypto', () => {
    expect(receiptSide('USDT', 'ETH')).toBe('BUY');
    expect(isReceiptEligible('USDT', 'ETH')).toBe(true);
  });

  it('null when same asset both ends', () => {
    expect(receiptSide('USDT', 'USDT')).toBeNull();
    expect(isReceiptEligible('USDT', 'USDT')).toBe(false);
    expect(receiptSide('BTC', 'BTC')).toBeNull();
  });
});

describe('computeReceiptDisplay', () => {
  it('SELL shows worse rate (less USDT per crypto) with positive spread', () => {
    // 1 BTC sold, the wallet finally received 65000 USDT real. Spread 0.5%.
    const r = computeReceiptDisplay(
      { amountIn: 1, realAmountOut: 65000, side: 'SELL' },
      0.005,
    );
    expect(r.realRateUsdtPerUnit).toBe(65000);
    expect(r.displayedRateUsdtPerUnit).toBeCloseTo(65000 * 0.995, 6);
    expect(r.displayedAmountIn).toBe(1);
    expect(r.displayedAmountOut).toBeCloseTo(65000 * 0.995, 6);
  });

  it('BUY shows worse rate (more USDT per crypto) with positive spread', () => {
    // 65000 USDT spent, wallet finally received 1 BTC. Spread 0.5%.
    const r = computeReceiptDisplay(
      { amountIn: 65000, realAmountOut: 1, side: 'BUY' },
      0.005,
    );
    expect(r.realRateUsdtPerUnit).toBe(65000);
    expect(r.displayedRateUsdtPerUnit).toBeCloseTo(65000 * 1.005, 6);
    expect(r.displayedAmountIn).toBe(65000);
    expect(r.displayedAmountOut).toBeCloseTo(65000 / (65000 * 1.005), 6);
  });

  it('zero spread leaves real rate intact and amount-out equal to net', () => {
    const r = computeReceiptDisplay(
      { amountIn: 2, realAmountOut: 130000, side: 'SELL' },
      0,
    );
    expect(r.displayedRateUsdtPerUnit).toBe(65000);
    expect(r.displayedAmountOut).toBe(130000);
  });

  it('uses post-commission net to derive the rate (closes the loop)', () => {
    // SELL: 1 BTC → MEX paid 65000 USDT raw, but commissions+fees left 64000
    // landing on-chain. With 0% spread the receipt should advertise the
    // 64000 USDT / BTC rate so the customer can verify amount on-chain.
    const r = computeReceiptDisplay(
      { amountIn: 1, realAmountOut: 64000, side: 'SELL' },
      0,
    );
    expect(r.displayedRateUsdtPerUnit).toBe(64000);
    expect(r.displayedAmountOut).toBe(64000);
  });
});
