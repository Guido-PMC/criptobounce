import { randomBytes } from 'node:crypto';

export function urlSafeToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateMasterKey(): string {
  return randomBytes(32).toString('base64');
}
