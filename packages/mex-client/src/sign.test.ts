import { describe, expect, it } from 'vitest';
import { signV3, buildQueryString } from './sign';

describe('signV3', () => {
  it('produces deterministic signature for known input', () => {
    const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0';
    const params = { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 1 };
    const ts = 1499827319559;
    const { signature } = signV3(secret, params, ts);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    // signature stays the same on re-run
    expect(signV3(secret, params, ts).signature).toBe(signature);
  });

  it('skips undefined/null values', () => {
    const qs = buildQueryString({ a: '1', b: undefined, c: 'x' });
    expect(qs).toBe('a=1&c=x');
  });

  it('handles params-less timestamp signing', () => {
    const { signature, query } = signV3('s', {}, 1000);
    expect(query).toContain('timestamp=1000');
    expect(query).toContain(`signature=${signature}`);
  });
});
