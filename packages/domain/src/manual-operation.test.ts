import { describe, expect, it } from 'vitest';
import {
  buildExpectedDepositAmount,
  calculateManualEstimatedOutput,
  calculateManualNominalForOutput,
  calculateManualSurplus,
  manualAmountsEqual,
  validateManualNominal,
} from './manual-operation';

describe('manual operation amounts', () => {
  it.each([
    ['100', '47', 'USDT', '100.47'],
    ['100', '08', 'USDC', '100.08'],
    ['0.5', '23', 'BTC', '0.50000023'],
    ['1', '08', 'ETH', '1.00000008'],
    ['1000', '55', 'TRX', '1000.0055'],
  ] as const)('builds %s + %s %s', (nominal, verifier, asset, expected) => {
    expect(buildExpectedDepositAmount(nominal, verifier, asset)).toBe(expected);
  });

  it('reserves the final two decimal positions for the verifier', () => {
    expect(() => validateManualNominal('0.12345678', 'BTC')).toThrow('supports at most 6 decimals');
  });

  it('compares normalized decimal values without floating point', () => {
    expect(manualAmountsEqual('0.500000230', '0.50000023', 'BTC')).toBe(true);
    expect(manualAmountsEqual('100.47000000', '100.47', 'USDT')).toBe(true);
  });

  it('calculates surplus and rejects over-execution', () => {
    expect(calculateManualSurplus('100.47', '100', 'USDT')).toBe('0.47');
    expect(() => calculateManualSurplus('100', '101', 'USDT')).toThrow('exceeds received');
  });

  it('links input and net output amounts for BUY quotes', () => {
    const quote = {
      price: '50000',
      side: 'BUY' as const,
      userCommission: { percent: 0.01, fixed: 0 },
      platformCommission: { percent: 0, fixed: 0 },
      networkFee: '0.0001',
    };
    expect(calculateManualEstimatedOutput('1000', quote)).toBe('0.01970000');
    expect(calculateManualNominalForOutput('0.0197', 'USDT', quote)).toBe('1000.00');
  });

  it('rounds derived nominal amounts up before reserving verifier digits', () => {
    const quote = {
      price: '2000',
      side: 'SELL' as const,
      userCommission: { percent: 0, fixed: 0 },
      platformCommission: { percent: 0, fixed: 0 },
      networkFee: '1',
    };
    expect(calculateManualNominalForOutput('100', 'ETH', quote)).toBe('0.05050000');
    expect(calculateManualEstimatedOutput('0.05050000', quote)).toBe('100.00000000');
  });
});
