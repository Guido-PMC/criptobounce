import { db } from '@/lib/db';
import { telegramMessages } from '@rb/db';

export interface NotificationInput {
  userId?: string;
  chatId: string;
  type: string;
  text: string;
  operationId?: string;
  dedupeKey?: string;
}

/**
 * Enqueue a Telegram notification. The bot service polls telegram_messages
 * for direction='out' and sentOk IS NULL.
 */
export async function sendNotification(input: NotificationInput): Promise<void> {
  await db
    .insert(telegramMessages)
    .values({
      operationId: input.operationId ?? null,
      userId: input.userId ?? null,
      chatId: input.chatId,
      direction: 'out',
      type: input.type,
      rawPayload: { text: input.text },
      sentOk: null,
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing();
}
