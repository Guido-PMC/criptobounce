import { config as loadDotEnv } from 'dotenv';
import { resolve } from 'node:path';
loadDotEnv({ path: resolve(process.cwd(), '../../.env') });
loadDotEnv();

import { loadBotEnv } from '@rb/config';
import { createDb } from '@rb/db';
import { Bot } from 'grammy';
import { logger } from './logger';
import { registerStartCommand } from './commands/start';
import { registerStatusCommand } from './commands/status';
import { registerPauseCommands } from './commands/pause';
import { registerPreciosCommand } from './commands/precios';
import { registerHelpCommand } from './commands/help';
import { startOutboundLoop } from './outbound';

const env = loadBotEnv();
const db = createDb(env.DATABASE_URL, { max: 5 });
const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

registerStartCommand(bot, { db, env });
registerStatusCommand(bot, { db });
registerPauseCommands(bot, { db });
registerPreciosCommand(bot, { db });
registerHelpCommand(bot);

bot.catch((err) => {
  logger.error({ err: err.error }, 'bot error');
});

async function main() {
  logger.info({ workerId: process.pid }, 'bot starting');
  // Outbound notification dispatcher
  startOutboundLoop({ db, bot });

  await bot.start({
    onStart: (info) => logger.info({ username: info.username }, 'bot started'),
  });
}

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  await bot.stop();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
