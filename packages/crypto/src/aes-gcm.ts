import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const ALGO = 'aes-256-gcm';

export function deriveKey(masterKeyB64: string): Buffer {
  const buf = Buffer.from(masterKeyB64, 'base64');
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must be ${KEY_LEN} bytes base64-encoded, got ${buf.length}`,
    );
  }
  return buf;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Output layout: [ iv(12) | tag(16) | ciphertext ]
 */
export function encrypt(plaintext: string | Buffer, key: Buffer): Buffer {
  if (key.length !== KEY_LEN) {
    throw new Error(`encrypt: key must be ${KEY_LEN} bytes`);
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decrypt(blob: Buffer, key: Buffer): string {
  if (key.length !== KEY_LEN) {
    throw new Error(`decrypt: key must be ${KEY_LEN} bytes`);
  }
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error('decrypt: blob too short');
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}

export function encryptString(plaintext: string, masterKeyB64: string): Buffer {
  return encrypt(plaintext, deriveKey(masterKeyB64));
}

export function decryptString(blob: Buffer, masterKeyB64: string): string {
  return decrypt(blob, deriveKey(masterKeyB64));
}
