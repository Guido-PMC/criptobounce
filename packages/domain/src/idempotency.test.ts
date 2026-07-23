import { describe, expect, it } from 'vitest';
import {
  conversionClientOrderId,
  manualOperationConversionOrderId,
  manualOperationPayoutOrderId,
  manualOperationRefundOrderId,
  platformSweepOrderId,
  userPayoutOrderId,
} from './idempotency';

describe('idempotency ids', () => {
  it('userPayoutOrderId is deterministic and within MEX limits', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(userPayoutOrderId(id)).toBe(userPayoutOrderId(id));
    expect(userPayoutOrderId(id).length).toBeLessThanOrEqual(32);
    expect(userPayoutOrderId(id).startsWith('rb-')).toBe(true);
  });

  it('platformSweepOrderId is deterministic per (sweep, account)', () => {
    const a = platformSweepOrderId('aaa', 'bbb');
    const b = platformSweepOrderId('aaa', 'bbb');
    const c = platformSweepOrderId('aaa', 'ccc');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('conversionClientOrderId is deterministic', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(conversionClientOrderId(id)).toBe(conversionClientOrderId(id));
  });

  it('manual operation ids are deterministic, distinct, and within MEX limits', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const values = [
      manualOperationConversionOrderId(id),
      manualOperationPayoutOrderId(id),
      manualOperationRefundOrderId(id),
    ];
    expect(new Set(values).size).toBe(3);
    for (const value of values) {
      expect(value.length).toBeLessThanOrEqual(32);
    }
    expect(manualOperationPayoutOrderId(id)).toBe(manualOperationPayoutOrderId(id));
    expect(manualOperationPayoutOrderId(id, 1)).not.toBe(manualOperationPayoutOrderId(id));
    expect(manualOperationPayoutOrderId(id, 123).length).toBeLessThanOrEqual(32);
  });
});
