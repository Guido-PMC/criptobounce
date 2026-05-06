import type { Bot } from 'grammy';
import { and, eq, isNull } from 'drizzle-orm';
import { users } from '@rb/db';
import type { Database } from '@rb/db';

export function registerPauseCommands(bot: Bot, { db }: { db: Database }) {
  bot.command('pause', async (ctx) => {
    const tg = ctx.from;
    if (!tg) return;
    const updated = await db
      .update(users)
      .set({ isPaused: true })
      .where(and(eq(users.telegramId, tg.id), isNull(users.deletedAt)))
      .returning();
    if (updated.length === 0) await ctx.reply('No estas registrado.');
    else await ctx.reply('Tus reenvios estan pausados. Usá /resume para reactivar.');
  });

  bot.command('resume', async (ctx) => {
    const tg = ctx.from;
    if (!tg) return;
    const updated = await db
      .update(users)
      .set({ isPaused: false })
      .where(and(eq(users.telegramId, tg.id), isNull(users.deletedAt)))
      .returning();
    if (updated.length === 0) await ctx.reply('No estas registrado.');
    else await ctx.reply('Reenvios activados.');
  });
}
