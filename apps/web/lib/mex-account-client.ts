import 'server-only';

import { decryptString } from '@rb/crypto';
import type { MexAccount } from '@rb/db';
import { MexClient } from '@rb/mex-client';

export function buildWebMexClient(mex: MexAccount): MexClient {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey) throw new Error('MASTER_ENCRYPTION_KEY no está configurada');
  return new MexClient({
    apiKey: decryptString(mex.apiKeyEnc, masterKey),
    apiSecret: decryptString(mex.apiSecretEnc, masterKey),
    host: process.env.MEX_HOST,
    requestTimeoutMs: 10_000,
  });
}
