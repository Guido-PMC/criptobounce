import type { Bot } from 'grammy';
import { and, eq, isNull } from 'drizzle-orm';
import { systemSettings, users } from '@rb/db';
import type { Database } from '@rb/db';
import type { MaintenanceModeValue } from '@rb/db';

interface Ctx {
  db: Database;
}

export function registerStatusCommand(bot: Bot, { db }: Ctx) {
  bot.command('status', async (ctx) => {
    const tg = ctx.from;
    if (!tg) return;

    const user = await db.query.users.findFirst({
      where: and(eq(users.telegramId, tg.id), isNull(users.deletedAt)),
    });

    const maintRow = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'maintenance_mode'),
    });
    const maint = maintRow?.value as MaintenanceModeValue | undefined;

    const lines: string[] = [];
    if (maint?.enabled) {
      lines.push('Sistema en mantenimiento. Reenvios pausados temporalmente.');
    }
    if (!user) lines.push('No estas registrado. Mandá /start.');
    else {
      lines.push(`Estado: ${user.status}`);
      if (user.isPaused) lines.push('Tu cuenta esta pausada (reenvios off).');
      if (user.pausedAssets.length > 0) {
        lines.push(`Activos pausados: ${user.pausedAssets.join(', ')}`);
      }
    }
    await ctx.reply(lines.join('\n'));
  });
}
