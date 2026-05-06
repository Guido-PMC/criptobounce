import { db } from '@/lib/db';
import { telegramMessages } from '@rb/db';

export interface NotificationInput {
  userId?: string;
  chatId: string;
  type: 'deposit_detected' | 'deposit_confirmed' | 'bounce_done' | 'bounce_failed' | 'bounce_on_hold' | 'admin_alert' | 'welcome' | 'maintenance';
  text: string;
  operationId?: string;
}

/**
 * Enqueue a Telegram notification. The bot service polls telegram_messages
 * for direction='out' and sentOk IS NULL.
 */
export async function sendNotification(input: NotificationInput): Promise<void> {
  await db.insert(telegramMessages).values({
    operationId: input.operationId ?? null,
    userId: input.userId ?? null,
    chatId: input.chatId,
    direction: 'out',
    type: input.type,
    rawPayload: { text: input.text },
    sentOk: null,
  });
}
