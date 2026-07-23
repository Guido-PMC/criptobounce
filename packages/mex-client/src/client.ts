import { z } from 'zod';
import { MexBusinessError, MexNetworkError } from './errors';
import { signV3 } from './sign';
import { type MexTracer, NoopTracer, redact } from './tracer';
import {
  type MexAccountInfo,
  MexAccountInfoSchema,
  type MexCapitalConfigEntry,
  MexCapitalConfigEntrySchema,
  type MexDeposit,
  type MexDepositAddress,
  MexDepositAddressSchema,
  MexDepositSchema,
  MexExchangeInfoSchema,
  type MexOrderResponse,
  MexOrderResponseSchema,
  type MexSymbolInfo,
  type MexTrade,
  MexTradeSchema,
  type MexWithdraw,
  type MexWithdrawApplyResponse,
  MexWithdrawApplyResponseSchema,
  MexWithdrawSchema,
} from './types';

export interface MexClientOptions {
  apiKey: string;
  apiSecret: string;
  host?: string;
  tracer?: MexTracer;
  recvWindow?: number;
  requestTimeoutMs?: number;
  /** Skip the actual HTTP call for write endpoints; for DRY_RUN. */
  dryRun?: boolean;
}

const WRITE_METHODS = new Set(['POST', 'DELETE', 'PUT', 'PATCH']);

export interface WithdrawArgs {
  coin: string;
  network: string;
  address: string;
  amount: string | number;
  withdrawOrderId: string;
  memo?: string;
  remark?: string;
}

export interface NewOrderArgs {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'IMMEDIATE_OR_CANCEL';
  quantity?: string | number;
  quoteOrderQty?: string | number;
  price?: string | number;
  newClientOrderId?: string;
}

export class MexClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly host: string;
  private readonly tracer: MexTracer;
  private readonly recvWindow: number;
  private readonly dryRun: boolean;
  private readonly requestTimeoutMs: number;

  constructor(opts: MexClientOptions) {
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.host = opts.host ?? 'https://api.mexc.com';
    this.tracer = opts.tracer ?? NoopTracer;
    this.recvWindow = opts.recvWindow ?? 5000;
    this.dryRun = opts.dryRun ?? false;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
  }

  // === Public ===

  async ping(): Promise<{ ok: true }> {
    await this.publicRequest('GET', '/api/v3/ping');
    return { ok: true };
  }

  async getServerTime(): Promise<number> {
    const res = await this.publicRequest('GET', '/api/v3/time');
    const json = (await res.json()) as { serverTime: number };
    return json.serverTime;
  }

  /**
   * Fetches the trading rules / precision metadata for a single spot symbol.
   * Returns null when MEX doesn't know the symbol (e.g. de-listed) or returns
   * an empty payload. Public endpoint, no auth needed.
   */
  async getSymbolInfo(symbol: string): Promise<MexSymbolInfo | null> {
    const res = await this.publicRequest(
      'GET',
      `/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const result = MexExchangeInfoSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data.symbols.find((s) => s.symbol === symbol) ?? null;
  }

  // === Private ===

  async getAccountInfo(): Promise<MexAccountInfo> {
    const json = await this.signedJson('GET', '/api/v3/account', {});
    return MexAccountInfoSchema.parse(json);
  }

  async getDepositHistory(
    args: {
      coin?: string;
      status?: number;
      startTime?: number;
      endTime?: number;
      limit?: number;
    } = {},
  ): Promise<MexDeposit[]> {
    const json = await this.signedJson('GET', '/api/v3/capital/deposit/hisrec', args);
    return z.array(MexDepositSchema).parse(json);
  }

  async getWithdrawHistory(
    args: {
      coin?: string;
      status?: number;
      startTime?: number;
      endTime?: number;
      limit?: number;
      withdrawOrderId?: string;
    } = {},
  ): Promise<MexWithdraw[]> {
    const json = await this.signedJson('GET', '/api/v3/capital/withdraw/history', args);
    return z.array(MexWithdrawSchema).parse(json);
  }

  async withdraw(args: WithdrawArgs): Promise<MexWithdrawApplyResponse> {
    const json = await this.signedJson(
      'POST',
      '/api/v3/capital/withdraw/apply',
      {
        coin: args.coin,
        network: args.network,
        address: args.address,
        amount: String(args.amount),
        withdrawOrderId: args.withdrawOrderId,
        memo: args.memo,
        remark: args.remark,
      },
      args.withdrawOrderId,
    );
    return MexWithdrawApplyResponseSchema.parse(json);
  }

  async newOrder(args: NewOrderArgs): Promise<MexOrderResponse> {
    const json = await this.signedJson('POST', '/api/v3/order', {
      symbol: args.symbol,
      side: args.side,
      type: args.type,
      quantity: args.quantity !== undefined ? String(args.quantity) : undefined,
      quoteOrderQty: args.quoteOrderQty !== undefined ? String(args.quoteOrderQty) : undefined,
      price: args.price !== undefined ? String(args.price) : undefined,
      newClientOrderId: args.newClientOrderId,
    });
    return MexOrderResponseSchema.parse(json);
  }

  async queryOrder(args: {
    symbol: string;
    orderId?: string;
    origClientOrderId?: string;
  }): Promise<MexOrderResponse> {
    const json = await this.signedJson('GET', '/api/v3/order', args);
    return MexOrderResponseSchema.parse(json);
  }

  async getMyTrades(args: {
    symbol: string;
    orderId?: string;
    limit?: number;
    fromId?: string;
  }): Promise<MexTrade[]> {
    const json = await this.signedJson('GET', '/api/v3/myTrades', args);
    return z.array(MexTradeSchema).parse(json);
  }

  /**
   * Returns the user's deposit address for a given (coin, network).
   * Returns null when MEXC has not generated an address yet for the pair
   * (call generateDepositAddress first in that case).
   */
  async getDepositAddress(args: {
    coin: string;
    network: string;
  }): Promise<MexDepositAddress | null> {
    try {
      const json = await this.signedJson('GET', '/api/v3/capital/deposit/address', {
        coin: args.coin,
        network: args.network,
      });
      const arr = Array.isArray(json) ? json : [json];
      if (arr.length === 0) return null;
      return MexDepositAddressSchema.parse(arr[0]);
    } catch (err) {
      if (err instanceof MexBusinessError && isAddressNotGeneratedError(err)) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Generates a fresh deposit address on MEXC for (coin, network).
   * In dryRun mode this returns { address: null } without hitting the wire.
   */
  async generateDepositAddress(args: { coin: string; network: string }): Promise<{
    address: string | null;
    memo: string | null;
  }> {
    const json = await this.signedJson('POST', '/api/v3/capital/deposit/address', {
      coin: args.coin,
      network: args.network,
    });
    const j = (json ?? {}) as Record<string, unknown>;
    const address = typeof j.address === 'string' ? j.address : null;
    const memo = typeof j.memo === 'string' ? j.memo : typeof j.tag === 'string' ? j.tag : null;
    return { address, memo };
  }

  async getCapitalConfig(): Promise<MexCapitalConfigEntry[]> {
    const json = await this.signedJson('GET', '/api/v3/capital/config/getall', {});
    return z.array(MexCapitalConfigEntrySchema).parse(json);
  }

  // === Internals ===

  private async publicRequest(method: string, path: string): Promise<Response> {
    const url = `${this.host}${path}`;
    try {
      const res = await fetch(url, {
        method,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      return res;
    } catch (err) {
      throw new MexNetworkError(`network error on ${method} ${path}`, err);
    }
  }

  private async signedJson(
    method: string,
    endpoint: string,
    params: Record<string, string | number | undefined>,
    withdrawOrderId?: string,
  ): Promise<unknown> {
    const isWrite = WRITE_METHODS.has(method);

    if (this.dryRun && isWrite) {
      const stamp = `dry-${Date.now()}`;
      await this.safeLog({
        method,
        endpoint,
        requestParams: { ...params, _dryRun: true } as Record<string, unknown>,
        responseStatus: 200,
        responseBody: { dryRun: true, fakeId: stamp } as unknown,
        responseMs: 0,
        withdrawOrderId,
      });
      return { id: stamp, dryRun: true };
    }

    const ts = Date.now();
    const { query } = signV3(this.apiSecret, params, ts);
    const url = `${this.host}${endpoint}?${query}`;
    const headers: Record<string, string> = {
      'X-MEXC-APIKEY': this.apiKey,
      'Content-Type': 'application/json',
    };

    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      const elapsed = Date.now() - t0;
      await this.safeLog({
        method,
        endpoint,
        requestParams: redactParams(params),
        responseMs: elapsed,
        error: err instanceof Error ? err.message : String(err),
        withdrawOrderId,
      });
      throw new MexNetworkError(`network error on ${method} ${endpoint}`, err);
    }
    const elapsed = Date.now() - t0;

    let body: unknown;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 2000) };
      }
    }

    const status = res.status;
    // Persist every call to mex_api_calls so admins can audit MEX traffic in full.
    // The tracer's shouldLog hook can still opt OUT specific calls if it returns false.
    const optOut = this.tracer.shouldLog?.({ method, endpoint, status }) === false;
    if (!optOut) {
      await this.safeLog({
        method,
        endpoint,
        requestParams: redactParams(params),
        responseStatus: status,
        responseBody: redact(body),
        responseMs: elapsed,
        withdrawOrderId,
      });
    }

    if (!res.ok) {
      const b = body as { code?: number; msg?: string } | undefined;
      throw new MexBusinessError(
        `MEX ${method} ${endpoint} failed: ${status} ${b?.msg ?? ''}`,
        status,
        b?.code,
        b?.msg,
        body,
      );
    }
    return body;
  }

  private async safeLog(record: Parameters<MexTracer['logCall']>[0]): Promise<void> {
    try {
      await this.tracer.logCall(record);
    } catch (err) {
      // Tracing failures must not break the call. Surface to stderr.
      console.error('[mex-client] tracer.logCall failed', err);
    }
  }
}

function redactParams(p: Record<string, string | number | undefined>): Record<string, unknown> {
  return redact(p) as Record<string, unknown>;
}

/**
 * Heuristic: detect MEXC responses meaning "no deposit address generated yet for this pair".
 * MEXC has shifted error wording across versions, so we match on common substrings + known codes.
 */
function isAddressNotGeneratedError(err: MexBusinessError): boolean {
  const m = (err.mexMessage ?? '').toLowerCase();
  if (
    m.includes('address not exist') ||
    m.includes('no address') ||
    m.includes('not generated') ||
    m.includes('please generate') ||
    m.includes('no deposit address')
  ) {
    return true;
  }
  // Known MEXC codes for "address not generated" / "address not found" observed in the wild.
  // Add more as we hit them.
  if (err.mexCode === 700003 || err.mexCode === 70011) return true;
  return false;
}
