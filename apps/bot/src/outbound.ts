import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import type { Bot } from 'grammy';
import { telegramMessages } from '@rb/db';
import type { Database } from '@rb/db';
import { logger } from './logger';

const POLL_MS = 2000;
const BATCH = 25;

export function startOutboundLoop({ db, bot }: { db: Database; bot: Bot }) {
  const tick = async () => {
    try {
      const pending = await db
        .select()
        .from(telegramMessages)
        .where(and(eq(telegramMessages.direction, 'out'), isNull(telegramMessages.sentOk)))
        .orderBy(asc(telegramMessages.ts))
        .limit(BATCH);

      for (const msg of pending) {
        const text = (msg.rawPayload as { text?: string } | null)?.text ?? '';
        if (!msg.chatId || !text) {
          await db
            .update(telegramMessages)
            .set({ sentOk: false, error: 'no chatId or text' })
            .where(eq(telegramMessages.id, msg.id));
          continue;
        }
        try {
          await bot.api.sendMessage(msg.chatId, text);
          await db
            .update(telegramMessages)
            .set({ sentOk: true })
            .where(eq(telegramMessages.id, msg.id));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn({ err: errMsg, msgId: msg.id }, 'failed to send telegram message');
          await db
            .update(telegramMessages)
            .set({ sentOk: false, error: errMsg })
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
