import { describe, expect, it } from 'vitest';
import {
  FINANCIAL_LOCKING_MANUAL_STATES,
  isFinanciallyLockingManualState,
} from './financial-account-lock';
import { resolveSnapshottedMexNetwork } from './lib/mex-network-resolver';
import { calculatePayoutSubmission, calculateRefundSubmission } from './manual-operation-engine';
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

  it('floors dynamic payouts to the live MEX withdrawal multiple', () => {
    const result = calculatePayoutSubmission('12.34567891', '0.01');
    expect(result.submitted.toFixed(8)).toBe('12.34000000');
    expect(result.dust.toFixed(8)).toBe('0.00567891');
  });

  it('resolves the exact snapshotted MEX withdrawal route', () => {
    const capital = [
      {
        coin: 'SOL',
        networkList: [
          {
            coin: 'SOL',
            network: 'SOL',
            withdrawEnable: true,
            withdrawFee: '0.01',
            withdrawMin: '0.1',
            withdrawIntegerMultiple: '0.000001',
          },
          {
            coin: 'SOL',
            network: 'BSC',
            withdrawEnable: false,
            withdrawFee: '0.02',
            withdrawMin: '0.2',
          },
        ],
      },
    ];

    expect(resolveSnapshottedMexNetwork('SOL', 'SOL', capital)).toEqual({
      coin: 'SOL',
      network: 'SOL',
      withdrawFee: 0.01,
      withdrawMin: 0.1,
      withdrawIntegerMultiple: '0.000001',
    });
    expect(resolveSnapshottedMexNetwork('SOL', 'BSC', capital)).toBeNull();
  });
});
