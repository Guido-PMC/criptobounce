import type { WorkerEnv } from '@rb/config';
import type { Database } from '@rb/db';
import { manualOperations } from '@rb/db';
import { and, eq, lt } from 'drizzle-orm';
import { logger } from './logger';
import { notify, tpl } from './notifier';

const POLL_MS = 30_000;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

export function startManualOperationExpiry({ db }: Ctx): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const expired = await db
        .update(manualOperations)
        .set({
          state: 'expired',
          updatedAt: new Date(),
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        })
        .where(
          and(
            eq(manualOperations.state, 'awaiting_deposit'),
            lt(manualOperations.expiresAt, new Date()),
          ),
        )
        .returning({
          id: manualOperations.id,
          userId: manualOperations.userId,
          version: manualOperations.version,
        });

      for (const op of expired) {
        await notify(db, {
          type: 'manual_op_expired',
          userId: op.userId,
          text: tpl.manualExpired(),
          dedupeKey: `manual-op:${op.id}:expired:${op.version}`,
        });
      }
    } catch (err) {
      logger.error({ err }, 'manual-operation expiry iteration failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };
  timer = setTimeout(tick, 3_000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
