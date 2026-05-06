import { describe, expect, it } from 'vitest';
import { redact } from './tracer';

describe('redact', () => {
  it('redacts sensitive keys (case-insensitive)', () => {
    const out = redact({
      apiKey: 'k',
      Signature: 'sig',
      foo: 'bar',
      nested: { password: 'p', x: 'ok' },
    }) as Record<string, unknown>;
    expect(out.Signature).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).x).toBe('ok');
    expect(out.foo).toBe('bar');
  });

  it('truncates very long strings', () => {
    const big = 'a'.repeat(150_000);
    const out = redact(big) as string;
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain('truncated');
  });

  it('handles arrays', () => {
    const out = redact([{ signature: 'x' }, { ok: 1 }]) as Array<Record<string, unknown>>;
    expect(out[0]?.signature).toBe('[REDACTED]');
    expect(out[1]?.ok).toBe(1);
  });
});
