import { describe, expect, it } from 'vitest';
import { conversionClientOrderId, platformSweepOrderId, userPayoutOrderId } from './idempotency';

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
});
