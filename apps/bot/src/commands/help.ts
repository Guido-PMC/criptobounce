import type { Bot } from 'grammy';

const HELP_TEXT = [
  'Comandos disponibles:',
  '',
  '/start - Registra tu cuenta o te reenvia el link de ingreso si ya estas aprobado.',
  '/status - Muestra el estado de tu cuenta, si esta pausada y si el sistema esta en mantenimiento.',
  '/precios - Precios actuales de los activos en MEX con comisiones aplicadas.',
  '/pause - Pausa los reenvios de tu cuenta.',
  '/resume - Reactiva los reenvios.',
  '/help - Muestra esta ayuda.',
].join('\n');

export function registerHelpCommand(bot: Bot) {
  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });
}
