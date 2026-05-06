import { sql } from 'drizzle-orm';
import type { Database } from '@rb/db';
import type { WorkerEnv } from '@rb/config';
import cron from 'node-cron';
import { logger } from './logger';

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

export function startRetentionCleanup({ db, env }: Ctx): () => void {
  const task = cron.schedule('0 4 * * *', async () => {
    try {
      await runOnce(db, env.LOG_RETENTION_DAYS);
    } catch (err) {
      logger.error({ err }, 'retention cleanup failed');
    }
  });
  task.start();
  logger.info({ days: env.LOG_RETENTION_DAYS }, 'retention cleanup cron scheduled');
  return () => task.stop();
}

async function runOnce(db: Database, days: number) {
  const cutoff = sql`now() - (${days}::int || ' days')::interval`;

  // Trace events first (heaviest), then mex_api_calls, then operations (cascade would
  // do this but explicit DELETE is faster for big tables). Then telegram_messages.
  const t0 = Date.now();
  await db.execute(sql`DELETE FROM trace_events WHERE ts < ${cutoff}`);
  await db.execute(sql`DELETE FROM mex_api_calls WHERE ts < ${cutoff}`);
  await db.execute(sql`DELETE FROM operations WHERE started_at < ${cutoff}`);
  await db.execute(sql`DELETE FROM telegram_messages WHERE ts < ${cutoff}`);

  // Cannot run VACUUM inside an explicit transaction; postgres-js auto-commits each query.
  try {
    await db.execute(sql`VACUUM ANALYZE trace_events`);
    await db.execute(sql`VACUUM ANALYZE mex_api_calls`);
    await db.execute(sql`VACUUM ANALYZE operations`);
    await db.execute(sql`VACUUM ANALYZE telegram_messages`);
  } catch (err) {
    logger.warn({ err }, 'VACUUM ANALYZE skipped (likely not allowed in current connection mode)');
  }

  logger.info({ ms: Date.now() - t0 }, 'retention cleanup done');
}
