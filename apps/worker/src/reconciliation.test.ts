import { describe, expect, it } from 'vitest';
import { shouldCloseMissingWithdrawal } from './reconciliation';

describe('stale withdrawal reconciliation', () => {
  const now = new Date('2026-07-23T12:00:00.000Z');

  it('keeps a MEX-missing withdrawal open before 48 hours', () => {
    expect(shouldCloseMissingWithdrawal(new Date('2026-07-21T12:00:00.001Z'), now)).toBe(false);
  });

  it('closes a MEX-missing withdrawal at 48 hours', () => {
    expect(shouldCloseMissingWithdrawal(new Date('2026-07-21T12:00:00.000Z'), now)).toBe(true);
  });
});
