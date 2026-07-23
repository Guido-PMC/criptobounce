import { resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
loadDotEnv({ path: resolve(process.cwd(), '../../.env') });
loadDotEnv();

import { loadWorkerEnv } from '@rb/config';
import { createDb } from '@rb/db';
import { startBalanceSync } from './balance-sync';
import { startBounceEngine } from './bounce-engine';
import { startDepositAddressSync } from './deposit-address-sync';
import { startDepositWatcher } from './deposit-watcher';
import { logger } from './logger';
import { startManualOperationEngine } from './manual-operation-engine';
import { startManualOperationExpiry } from './manual-operation-expiry';
import { startManualSweepDispatcher } from './manual-sweep';
import { startReconciliation } from './reconciliation';
import { startRetentionCleanup } from './retention-cleanup';
import { startSweepCron } from './sweep-cron';

const env = loadWorkerEnv();
const db = createDb(env.DATABASE_URL, { max: 5 });

logger.info({ workerId: env.WORKER_ID, dryRun: env.DRY_RUN }, 'worker starting');

const stoppers: Array<() => Promise<void> | void> = [];

stoppers.push(startDepositWatcher({ db, env }));
stoppers.push(startBounceEngine({ db, env }));
stoppers.push(startReconciliation({ db, env }));
stoppers.push(startSweepCron({ db, env }));
stoppers.push(startRetentionCleanup({ db, env }));
stoppers.push(startBalanceSync({ db, env }));
stoppers.push(startDepositAddressSync({ db, env }));
stoppers.push(startManualSweepDispatcher({ db, env }));
stoppers.push(startManualOperationExpiry({ db, env }));
stoppers.push(startManualOperationEngine({ db, env }));

logger.info('worker loops started');

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown requested');
  await Promise.all(stoppers.map((s) => Promise.resolve(s())));
  logger.info('shutdown complete');
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
