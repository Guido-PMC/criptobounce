import { telegramMessages } from '@rb/db';
import type { Database } from '@rb/db';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Bot } from 'grammy';
import { logger } from './logger';

const POLL_MS = 2000;
const BATCH = 25;
const MAX_ATTEMPTS = 8;

export function startOutboundLoop({ db, bot }: { db: Database; bot: Bot }) {
  const tick = async () => {
    try {
      const pending = await claimPendingMessages(db);

      for (const msg of pending) {
        const text = (msg.rawPayload as { text?: string } | null)?.text ?? '';
        if (!msg.chatId || !text) {
          await db
            .update(telegramMessages)
            .set({
              sentOk: false,
              error: 'no chatId or text',
              attemptCount: MAX_ATTEMPTS,
              nextAttemptAt: null,
            })
            .where(eq(telegramMessages.id, msg.id));
          continue;
        }
        try {
          await bot.api.sendMessage(msg.chatId, text);
          await db
            .update(telegramMessages)
            .set({ sentOk: true, error: null, nextAttemptAt: null })
            .where(eq(telegramMessages.id, msg.id));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn({ err: errMsg, msgId: msg.id }, 'failed to send telegram message');
          const attempts = msg.attemptCount + 1;
          const backoffMs = Math.min(60 * 60_000, 2 ** attempts * 5_000);
          await db
            .update(telegramMessages)
            .set({
              sentOk: false,
              error: errMsg,
              attemptCount: attempts,
              nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + backoffMs),
            })
            .where(eq(telegramMessages.id, msg.id));
        }
      }
    } catch (err) {
      logger.error({ err }, 'outbound loop iteration failed');
    } finally {
      setTimeout(tick, POLL_MS);
    }
  };
  setTimeout(tick, POLL_MS);
}

async function claimPendingMessages(db: Database) {
  return db.transaction(async (tx) => {
    const claimed = await tx.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT id
        FROM telegram_messages
        WHERE direction = 'out'
          AND (sent_ok IS NULL OR sent_ok = false)
          AND attempt_count < ${MAX_ATTEMPTS}
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY ts ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH}
      )
      UPDATE telegram_messages
      SET next_attempt_at = now() + interval '5 minutes'
      WHERE id IN (SELECT id FROM candidates)
      RETURNING id
    `);
    const ids = (claimed as unknown as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) return [];
    return tx.select().from(telegramMessages).where(inArray(telegramMessages.id, ids));
  });
}
