import { describe, expect, it } from 'vitest';
import {
  FINANCIAL_LOCKING_MANUAL_STATES,
  isFinanciallyLockingManualState,
} from './financial-account-lock';
import { calculateRefundSubmission } from './manual-operation-engine';
import { classifyManualDeposit } from './manual-operation-match';

describe('manual operation worker helpers', () => {
  it('holds the financial lock for every active state, including on_hold', () => {
    for (const state of FINANCIAL_LOCKING_MANUAL_STATES) {
      expect(isFinanciallyLockingManualState(state)).toBe(true);
    }
    for (const terminal of ['done', 'failed', 'expired', 'cancelled']) {
      expect(isFinanciallyLockingManualState(terminal)).toBe(false);
    }
  });

  it('matches exact amounts without floating point tolerance', () => {
    expect(classifyManualDeposit('0.50000023', '0.50000023', 'BTC')).toBe('exact');
    expect(classifyManualDeposit('0.50000024', '0.50000023', 'BTC')).toBe('mismatch');
    expect(classifyManualDeposit('100.47000000', '100.47', 'USDT')).toBe('exact');
  });

  it('only refunds above live minimum plus fee and floors to MEX multiple', () => {
    expect(calculateRefundSubmission('10.5', '10', '0.5')).toBeNull();
    expect(calculateRefundSubmission('10.50000001', '10', '0.5')).toBe('10.50000001');
    expect(calculateRefundSubmission('10.57', '10', '0.5', '0.1')).toBeNull();
    expect(calculateRefundSubmission('10.67', '10', '0.5', '0.1')).toBe('10.60000000');
  });
});
