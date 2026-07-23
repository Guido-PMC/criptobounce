import Decimal from 'decimal.js';
import type { Asset } from './assets';

export const MANUAL_OPERATION_TTL_MS = 15 * 60 * 1000;
export const MANUAL_OPERATION_QUOTE_MAX_AGE_MS = 30_000;
export const DEFAULT_MANUAL_OPERATION_SLIPPAGE_BPS = 200;

const VERIFIER_SCALE: Record<Asset, number> = {
  USDT: 2,
  USDC: 2,
  BTC: 8,
  ETH: 8,
  TRX: 4,
};

export function verifierScale(asset: Asset): number {
  return VERIFIER_SCALE[asset];
}

export function normalizeManualAmount(value: Decimal.Value, asset: Asset): string {
  return new Decimal(value).toFixed(verifierScale(asset));
}

export function validateManualNominal(value: Decimal.Value, asset: Asset): string {
  const scale = verifierScale(asset);
  const nominalScale = Math.max(0, scale - 2);
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.lte(0)) throw new Error('amount must be positive');
  if (amount.decimalPlaces() > nominalScale) {
    throw new Error(`${asset} nominal amount supports at most ${nominalScale} decimals`);
  }
  return amount.toFixed(scale);
}

export function buildExpectedDepositAmount(
  nominal: Decimal.Value,
  verifierDigits: string,
  asset: Asset,
): string {
  if (!/^(0[1-9]|[1-9][0-9])$/.test(verifierDigits)) {
    throw new Error('verifier must be between 01 and 99');
  }
  const normalized = validateManualNominal(nominal, asset);
  const increment = new Decimal(verifierDigits).mul(new Decimal(10).pow(-verifierScale(asset)));
  return new Decimal(normalized).add(increment).toFixed(verifierScale(asset));
}

export function manualAmountsEqual(
  left: Decimal.Value,
  right: Decimal.Value,
  asset: Asset,
): boolean {
  return normalizeManualAmount(left, asset) === normalizeManualAmount(right, asset);
}

export function calculateManualSurplus(
  received: Decimal.Value,
  amountToExecute: Decimal.Value,
  asset: Asset,
): string {
  const receivedAmount = new Decimal(received);
  const executeAmount = new Decimal(amountToExecute);
  if (!receivedAmount.isFinite() || !executeAmount.isFinite() || executeAmount.lte(0)) {
    throw new Error('amounts must be positive');
  }
  if (executeAmount.gt(receivedAmount)) {
    throw new Error('amount to execute exceeds received amount');
  }
  return receivedAmount.sub(executeAmount).toFixed(verifierScale(asset));
}

export function isManualOperationProductPair(from: Asset, to: Asset): boolean {
  if (from === to) return true;
  return from === 'USDT' || from === 'USDC' || to === 'USDT' || to === 'USDC';
}
