import { z } from 'zod';

export interface BookTicker {
  symbol: string;
  bid: number;
  ask: number;
}

const BookTickerSchema = z.object({
  symbol: z.string(),
  bidPrice: z.string(),
  askPrice: z.string(),
  bidQty: z.string().optional().nullable(),
  askQty: z.string().optional().nullable(),
});

const DEFAULT_HOST = 'https://api.mexc.com';
const DEFAULT_TIMEOUT_MS = 5000;

export interface FetchBookTickersOptions {
  host?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Fetches book tickers (best bid / best ask) for a list of MEX spot symbols.
 *
 * Uses the public MEX REST endpoint /api/v3/ticker/bookTicker. Symbols are
 * fetched in parallel with one request each so a single bad symbol doesn't
 * poison the whole batch. Failed symbols are simply omitted from the result.
 */
export async function fetchBookTickers(
  symbols: string[],
  opts: FetchBookTickersOptions = {},
): Promise<BookTicker[]> {
  if (symbols.length === 0) return [];
  const host = opts.host ?? DEFAULT_HOST;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const results = await Promise.all(
    symbols.map(async (symbol) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // Chain external signal so caller cancellation also aborts the inner request.
      const onAbort = () => controller.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const url = `${host}/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return null;
        const json = await res.json();
        const parsed = BookTickerSchema.safeParse(json);
        if (!parsed.success) return null;
        const bid = Number(parsed.data.bidPrice);
        const ask = Number(parsed.data.askPrice);
        if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
        return { symbol: parsed.data.symbol, bid, ask } satisfies BookTicker;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }),
  );

  return results.filter((r): r is BookTicker => r !== null);
}
