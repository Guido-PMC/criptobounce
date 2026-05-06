import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './aes-gcm';
import { generateMasterKey } from './random';

describe('aes-gcm', () => {
  const key = Buffer.from(generateMasterKey(), 'base64');

  it('encrypt -> decrypt roundtrip', () => {
    const pt = 'mxc-secret-1234567890';
    const ct = encrypt(pt, key);
    expect(ct.length).toBe(pt.length + 12 + 16);
    expect(decrypt(ct, key)).toBe(pt);
  });

  it('uses different IV each call', () => {
    const pt = 'same-plaintext';
    const a = encrypt(pt, key);
    const b = encrypt(pt, key);
    expect(a.equals(b)).toBe(false);
  });

  it('rejects tampered ciphertext', () => {
    const pt = 'tamper-me';
    const ct = encrypt(pt, key);
    const last = ct.length - 1;
    const cur = ct[last];
    if (cur === undefined) throw new Error('unexpected');
    ct[last] = cur ^ 0x01;
    expect(() => decrypt(ct, key)).toThrow();
  });

  it('rejects wrong key', () => {
    const pt = 'wrong-key-test';
    const ct = encrypt(pt, key);
    const otherKey = Buffer.from(generateMasterKey(), 'base64');
    expect(() => decrypt(ct, otherKey)).toThrow();
  });

  it('rejects malformed key length', () => {
    const badKey = Buffer.alloc(16);
    expect(() => encrypt('x', badKey)).toThrow();
  });
});
