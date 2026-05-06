import type { Asset } from './assets';

export interface CommissionConfig {
  percent: number; // 0.0150 = 1.5%
  fixed: number;
}

export interface BounceCalculation {
  grossIn: number;
  amountAfterConv: number;
  userCommission: number;
  platformCommission: number;
  networkFeeEstimated: number;
  netToUser: number;
  isAboveMinimum: boolean;
}

export interface BounceInput {
  grossIn: number;
  amountAfterConv: number;
  user: CommissionConfig;
  platform: CommissionConfig;
  networkFeeEstimated: number;
  minOutput: number;
  asset: Asset;
}

/**
 * Order of deductions from amountAfterConv:
 * 1. user commission (visible to user)
 * 2. platform commission (hidden, accumulates in MEX, swept later)
 * 3. network fee (paid on-chain, MEX deducts on withdraw)
 * The user receives netToUser = amountAfterConv - sum(all)
 */
export function calculateBounce(input: BounceInput): BounceCalculation {
  const userCommission = round(input.amountAfterConv * input.user.percent + input.user.fixed, 8);
  const platformCommission = round(
    input.amountAfterConv * input.platform.percent + input.platform.fixed,
    8,
  );
  const totalDeductions = userCommission + platformCommission + input.networkFeeEstimated;
  const netToUser = round(input.amountAfterConv - totalDeductions, 8);

  return {
    grossIn: input.grossIn,
    amountAfterConv: input.amountAfterConv,
    userCommission,
    platformCommission,
    networkFeeEstimated: input.networkFeeEstimated,
    netToUser,
    isAboveMinimum: netToUser >= input.minOutput,
  };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
