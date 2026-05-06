import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@rb/db';
import type { WorkerEnv } from '@rb/config';
import { mexAccounts, users } from '@rb/db';
import { logger } from './logger';
import { runWithCorrelation, trace } from './correlation';
import { buildMexClient } from './mex-account';

const POLL_MS = 60_000;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

export function startBalanceSync({ db, env }: Ctx): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await syncOnce(db, env);
    } catch (err) {
      logger.error({ err }, 'balance-sync iteration failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };
  timer = setTimeout(tick, 7000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function syncOnce(db: Database, env: WorkerEnv) {
  const accounts = await db
    .select()
    .from(mexAccounts)
    .innerJoin(users, eq(users.id, mexAccounts.userId))
    .where(and(eq(mexAccounts.status, 'active'), isNull(users.deletedAt)));

  if (accounts.length === 0) return;

  await runWithCorrelation(
    db,
    {
      type: 'balance_sync',
      summary: `balance sync (${accounts.length} accounts)`,
    },
    async () => {
      let okCount = 0;
      let errCount = 0;
      for (const { mex_accounts: mex, users: u } of accounts) {
        try {
          const client = buildMexClient(db, env, mex);
          const info = await client.getAccountInfo();
          const cache = info.balances.filter((b) => Number(b.free) > 0 || Number(b.locked) > 0);
          await db
            .update(mexAccounts)
            .set({ lastBalanceSync: new Date(), balanceCache: cache })
            .where(eq(mexAccounts.id, mex.id));
          await trace(db, 'info', 'balance_synced', `account ${mex.mexEmail}`, {
            mexAccountId: mex.id,
            userId: u.id,
            balances: cache.length,
          });
          okCount += 1;
        } catch (err) {
          errCount += 1;
          await trace(db, 'warn', 'balance_sync_failed', `account ${mex.mexEmail}`, {
            mexAccountId: mex.id,
            userId: u.id,
            error: err instanceof Error ? err.message : String(err),
          });
          logger.warn({ err, mexAccountId: mex.id }, 'balance sync failed');
        }
      }
      await trace(db, 'info', 'balance_sync_summary', `ok=${okCount} err=${errCount}`);
    },
  );
}
