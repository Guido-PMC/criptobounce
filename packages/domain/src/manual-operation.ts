import Decimal from 'decimal.js';
import type { Asset } from './assets';

export const MANUAL_OPERATION_TTL_MS = 15 * 60 * 1000;
export const MANUAL_OPERATION_QUOTE_MAX_AGE_MS = 30_000;
export const DEFAULT_MANUAL_OPERATION_SLIPPAGE_BPS = 200;

export interface ManualCommissionConfig {
  percent: number;
  fixed: number;
}

export interface ManualQuoteCalculation {
  price: Decimal.Value;
  side: 'BUY' | 'SELL' | null;
  userCommission: ManualCommissionConfig;
  platformCommission: ManualCommissionConfig;
  networkFee: Decimal.Value;
}

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

function manualQuoteDeductions(calculation: ManualQuoteCalculation): {
  retainedRate: Decimal;
  fixedDeductions: Decimal;
} {
  const price = new Decimal(calculation.price);
  const networkFee = new Decimal(calculation.networkFee);
  const userPercent = new Decimal(calculation.userCommission.percent);
  const platformPercent = new Decimal(calculation.platformCommission.percent);
  const fixedDeductions = new Decimal(calculation.userCommission.fixed)
    .add(calculation.platformCommission.fixed)
    .add(networkFee);
  const retainedRate = new Decimal(1).sub(userPercent).sub(platformPercent);
  if (!price.isFinite() || price.lte(0)) throw new Error('quote price must be positive');
  if (!networkFee.isFinite() || networkFee.lt(0)) throw new Error('network fee must be positive');
  if (!retainedRate.isFinite() || retainedRate.lte(0)) {
    throw new Error('commissions consume the quoted amount');
  }
  return { retainedRate, fixedDeductions };
}

export function calculateManualEstimatedOutput(
  nominal: Decimal.Value,
  calculation: ManualQuoteCalculation,
): string {
  const source = new Decimal(nominal);
  if (!source.isFinite() || source.lte(0)) throw new Error('amount must be positive');
  const price = new Decimal(calculation.price);
  const gross =
    calculation.side === 'SELL'
      ? source.mul(price)
      : calculation.side === 'BUY'
        ? source.div(price)
        : source;
  const userCommission = gross
    .mul(calculation.userCommission.percent)
    .add(calculation.userCommission.fixed)
    .toDecimalPlaces(8);
  const platformCommission = gross
    .mul(calculation.platformCommission.percent)
    .add(calculation.platformCommission.fixed)
    .toDecimalPlaces(8);
  const networkFee = new Decimal(calculation.networkFee);
  manualQuoteDeductions(calculation);
  const net = gross.sub(userCommission).sub(platformCommission).sub(networkFee);
  if (!net.isFinite() || net.lte(0)) throw new Error('commissions and fee consume the estimate');
  return net.toFixed(8);
}

export function calculateManualNominalForOutput(
  desiredOutput: Decimal.Value,
  asset: Asset,
  calculation: ManualQuoteCalculation,
): string {
  const desired = new Decimal(desiredOutput);
  if (!desired.isFinite() || desired.lte(0)) throw new Error('amount must be positive');
  const price = new Decimal(calculation.price);
  const { retainedRate, fixedDeductions } = manualQuoteDeductions(calculation);
  const gross = desired.add(fixedDeductions).div(retainedRate);
  const source =
    calculation.side === 'SELL'
      ? gross.div(price)
      : calculation.side === 'BUY'
        ? gross.mul(price)
        : gross;
  const nominalScale = Math.max(0, verifierScale(asset) - 2);
  const step = new Decimal(10).pow(-nominalScale);
  let nominal = source.toDecimalPlaces(nominalScale, Decimal.ROUND_UP);
  for (let adjustment = 0; adjustment < 100; adjustment += 1) {
    if (new Decimal(calculateManualEstimatedOutput(nominal, calculation)).gte(desired)) {
      return nominal.toFixed(verifierScale(asset));
    }
    nominal = nominal.add(step);
  }
  throw new Error('could not satisfy desired output at the supported input precision');
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
