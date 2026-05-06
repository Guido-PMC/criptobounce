import type { Bot } from 'grammy';
import { and, eq, isNull } from 'drizzle-orm';
import { getPlatformCommission, getUserCommission, users } from '@rb/db';
import type { Database } from '@rb/db';
import {
  applyCommissionToQuote,
  PRICEABLE_ASSETS,
  usdtSpotSymbol,
} from '@rb/domain';
import { fetchBookTickers } from '@rb/mex-client';
import { logger } from '../logger';

interface Ctx {
  db: Database;
}

const ZERO_COMMISSION = { percent: 0, fixed: 0 };

function formatPrice(asset: string, value: number): string {
  // BTC/ETH are quoted in USDT with 2 decimals; everything else gets 4 to keep
  // small-cap tokens readable. We also add thousand separators using es-AR.
  const decimals = asset === 'BTC' || asset === 'ETH' ? 2 : 4;
  return value.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function registerPreciosCommand(bot: Bot, { db }: Ctx) {
  bot.command('precios', async (ctx) => {
    const tg = ctx.from;
    if (!tg) return;

    const symbols: string[] = [];
    const assetForSymbol = new Map<string, string>();
    for (const asset of PRICEABLE_ASSETS) {
      const sym = usdtSpotSymbol(asset);
      if (!sym) continue;
      symbols.push(sym);
      assetForSymbol.set(sym, asset);
    }

    let tickers: Awaited<ReturnType<typeof fetchBookTickers>> = [];
    try {
      tickers = await fetchBookTickers(symbols, { timeoutMs: 4000 });
    } catch (err) {
      logger.warn({ err }, 'fetchBookTickers failed');
    }

    if (tickers.length === 0) {
      await ctx.reply('No pude obtener los precios de MEX en este momento. Probá en unos minutos.');
      return;
    }

    // If the sender is a registered (non-deleted) user, apply their per-user
    // commission. Otherwise (pending/unknown) we still reply with platform-only
    // commissions so /precios works for anyone who chats with the bot.
    const user = await db.query.users.findFirst({
      where: and(eq(users.telegramId, tg.id), isNull(users.deletedAt)),
    });

    const lines: string[] = ['Precios actuales (con comisiones aplicadas):', ''];

    for (const t of tickers) {
      const asset = assetForSymbol.get(t.symbol);
      if (!asset) continue;
      const platform = await getPlatformCommission(db, asset);
      const userComm = user
        ? await getUserCommission(db, user.id, asset)
        : ZERO_COMMISSION;
      const { compra, venta } = applyCommissionToQuote(
        { bid: t.bid, ask: t.ask },
        userComm,
        platform,
      );
      lines.push(
        `${asset}: compra ${formatPrice(asset, compra)} USDT  -  venta ${formatPrice(asset, venta)} USDT`,
      );
    }

    const ts = new Date().toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    lines.push('', `Actualizado ${ts}.`);

    await ctx.reply(lines.join('\n'));
  });
}
