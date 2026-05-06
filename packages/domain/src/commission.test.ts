import { describe, expect, it } from 'vitest';
import { calculateBounce } from './commission';

describe('calculateBounce', () => {
  it('basic same-asset USDT', () => {
    const r = calculateBounce({
      grossIn: 100,
      amountAfterConv: 100,
      user: { percent: 0.01, fixed: 0.5 },
      platform: { percent: 0.005, fixed: 0.3 },
      networkFeeEstimated: 1,
      minOutput: 5,
      asset: 'USDT',
    });
    expect(r.userCommission).toBeCloseTo(1.5, 8);
    expect(r.platformCommission).toBeCloseTo(0.8, 8);
    expect(r.netToUser).toBeCloseTo(96.7, 8);
    expect(r.isAboveMinimum).toBe(true);
  });

  it('flags below minimum', () => {
    const r = calculateBounce({
      grossIn: 6,
      amountAfterConv: 6,
      user: { percent: 0.01, fixed: 0.5 },
      platform: { percent: 0.005, fixed: 0.3 },
      networkFeeEstimated: 1,
      minOutput: 5,
      asset: 'USDT',
    });
    expect(r.isAboveMinimum).toBe(false);
  });
});
