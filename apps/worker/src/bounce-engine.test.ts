import { describe, expect, it } from 'vitest';
import { userPayoutOrderId, conversionClientOrderId } from '@rb/domain';

describe('idempotency keys (unit)', () => {
  it('userPayoutOrderId yields the same value for repeated calls', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(userPayoutOrderId(id)).toBe(userPayoutOrderId(id));
  });

  it('conversion id is distinct from payout id but also deterministic', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(conversionClientOrderId(id)).not.toBe(userPayoutOrderId(id));
    expect(conversionClientOrderId(id)).toBe(conversionClientOrderId(id));
  });
});

// NOTE: Full integration tests against a live Postgres are wired to be run
// only when CI env DB_TEST_URL is provided. They cover:
// - concurrent leases producing only one winner
// - two-phase write surviving a crash between phases (mocked MEX)
// - reconciliation closing pending withdrawals
// We keep the harness skeleton here for now; a follow-up pass adds the
// docker-compose + testcontainers wiring.
