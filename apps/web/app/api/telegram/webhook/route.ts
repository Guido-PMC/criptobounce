import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Telegram webhook stub. The bot service runs grammY in long polling for the
 * MVP. To migrate, point Telegram's setWebhook to this URL with a secret
 * token; verify it via the X-Telegram-Bot-Api-Secret-Token header and forward
 * the update to a queue (telegramMessages) for the bot's outbound loop to
 * also handle inbound, OR run grammY's webhookCallback against this route.
 *
 * This route exists so future migration is a config change, not new infra.
 */
export async function POST(req: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const got = req.headers.get('x-telegram-bot-api-secret-token');
    if (got !== expectedSecret) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit({ key: `telegram:${ip}`, max: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429 });
  }

  // For now, we ack but do not process. The bot service in long-polling mode
  // is the source of truth. When migrating to webhook mode, plug grammY here.
  return NextResponse.json({ ok: true });
}
