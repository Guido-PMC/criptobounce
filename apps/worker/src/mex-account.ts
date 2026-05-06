import type { Database, MexAccount } from '@rb/db';
import { decryptString } from '@rb/crypto';
import { MexClient } from '@rb/mex-client';
import type { WorkerEnv } from '@rb/config';
import { createMexTracer } from './tracing/mex-tracer';

export function buildMexClient(db: Database, env: WorkerEnv, mex: MexAccount): MexClient {
  const apiKey = decryptString(mex.apiKeyEnc, env.MASTER_ENCRYPTION_KEY);
  const apiSecret = decryptString(mex.apiSecretEnc, env.MASTER_ENCRYPTION_KEY);
  return new MexClient({
    apiKey,
    apiSecret,
    host: env.MEX_HOST,
    tracer: createMexTracer(db),
    dryRun: env.DRY_RUN,
  });
}
