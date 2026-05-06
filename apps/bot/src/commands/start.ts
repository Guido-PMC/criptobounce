import type { Bot } from 'grammy';
import { and, eq, isNull } from 'drizzle-orm';
import { auditLog, invitations, users, telegramMessages } from '@rb/db';
import type { Database } from '@rb/db';
import type { BotEnv } from '@rb/config';
import { logger } from '../logger';

interface Ctx {
  db: Database;
  env: BotEnv;
}

export function registerStartCommand(bot: Bot, { db, env }: Ctx) {
  bot.command('start', async (ctx) => {
    const tg = ctx.from;
    if (!tg) return;

    const tgId = tg.id;
    const username = tg.username ?? null;

    // Log inbound for audit
    await db.insert(telegramMessages).values({
      userId: null,
      chatId: String(ctx.chat?.id ?? tgId),
      direction: 'in',
      type: 'command',
      rawPayload: { text: '/start', from: { id: tgId, username } },
      sentOk: true,
    });

    let user = await db.query.users.findFirst({
      where: and(eq(users.telegramId, tgId), isNull(users.deletedAt)),
    });

    if (!user) {
      const inserted = await db
        .insert(users)
        .values({
          telegramId: tgId,
          telegramUsername: username,
          status: 'pending',
          role: 'user',
        })
        .returning();
      user = inserted[0]!;
      await db.insert(auditLog).values({
        actorId: null,
        action: 'user_self_registered',
        targetType: 'user',
        targetId: user.id,
        payload: { telegramId: tgId, username },
      });

      await ctx.reply(
        'Hola! Tu cuenta fue creada y esta pendiente de aprobacion. Te avisaremos por aca cuando puedas ingresar.',
      );

      // Notify admin
      await db.insert(telegramMessages).values({
        chatId: String(env.TELEGRAM_ADMIN_CHAT_ID),
        direction: 'out',
        type: 'admin_alert',
        rawPayload: {
          text: `Nuevo usuario pendiente:\nID: ${user.id}\nTelegram: @${username ?? '-'} (${tgId})`,
        },
        sentOk: null,
      });
      logger.info({ userId: user.id, tgId }, 'user self-registered');
      return;
    }

    if (user.status === 'pending') {
      await ctx.reply('Tu cuenta sigue pendiente de aprobacion. Avisamos en cuanto este lista.');
      return;
    }
    if (user.status === 'suspended') {
      await ctx.reply('Tu cuenta esta suspendida. Contacta al admin si pensas que es un error.');
      return;
    }

    if (user.googleEmail) {
      await ctx.reply(`Ya estas activo. Ingresa: ${env.WEB_PUBLIC_URL}/dashboard`);
      return;
    }

    // Approved but Google not linked yet -> resend invitation
    const inv = await db.query.invitations.findFirst({
      where: and(eq(invitations.userId, user.id), isNull(invitations.usedAt)),
      orderBy: (i, { desc }) => [desc(i.createdAt)],
    });
    if (inv && inv.expiresAt > new Date()) {
      await ctx.reply(`Tu link de ingreso (valido):\n${env.WEB_PUBLIC_URL}/i/${inv.token}`);
    } else {
      await ctx.reply(
        'Tu invitacion expiro. Pedile al admin que te genere un link nuevo.',
      );
    }
  });
}
