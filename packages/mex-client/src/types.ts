import { z } from 'zod';

export const MexBalanceSchema = z.object({
  asset: z.string(),
  free: z.string(),
  locked: z.string(),
});
export type MexBalance = z.infer<typeof MexBalanceSchema>;

export const MexAccountInfoSchema = z.object({
  makerCommission: z.number().nullable().optional(),
  takerCommission: z.number().nullable().optional(),
  canTrade: z.boolean().nullable().optional(),
  canWithdraw: z.boolean().nullable().optional(),
  canDeposit: z.boolean().nullable().optional(),
  updateTime: z.number().nullable().optional(),
  accountType: z.string().nullable().optional(),
  balances: z.array(MexBalanceSchema),
  permissions: z.array(z.string()).nullable().optional(),
});
export type MexAccountInfo = z.infer<typeof MexAccountInfoSchema>;

export const MexDepositSchema = z.object({
  amount: z.string(),
  coin: z.string(),
  network: z.string(),
  status: z.number(), // 1 = small, 2 = pending, 5 = credited, 6 = success
  address: z.string(),
  addressTag: z.string().optional().nullable(),
  txId: z.string(),
  insertTime: z.number(),
  unlockConfirm: z.string().optional(),
  confirmTimes: z.string().optional(),
  memo: z.string().optional().nullable(),
});
export type MexDeposit = z.infer<typeof MexDepositSchema>;

/** MEX serializes timestamps inconsistently: sometimes as ms epoch number, sometimes as string. */
const MexTimestamp = z.union([z.number(), z.string()]).nullable().optional();
/** MEX serializes amounts/fees as either string or number. */
const MexAmount = z.union([z.string(), z.number()]).nullable().optional();

export const MexWithdrawSchema = z.object({
  id: z.string(),
  txId: z.string().nullable().optional(),
  coin: z.string(),
  network: z.string(),
  address: z.string(),
  amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  transferType: z.number().nullable().optional(),
  status: z.number(), // 1 created, 2 cancelled, 3 awaiting, 4 approved, 5 wait packaging, 6 wait confirmation, 7 success, 8 failure, 10 manual review
  transactionFee: MexAmount,
  confirmNo: z.number().nullable().optional(),
  applyTime: MexTimestamp,
  remark: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  withdrawOrderId: z.string().nullable().optional(),
});
export type MexWithdraw = z.infer<typeof MexWithdrawSchema>;

export const MexWithdrawApplyResponseSchema = z.object({
  id: z.string(),
});
export type MexWithdrawApplyResponse = z.infer<typeof MexWithdrawApplyResponseSchema>;

/**
 * MEX `POST /api/v3/order` returns a SLIM payload (just `symbol`, `orderId`,
 * `clientOrderId`, `transactTime`) — fill data (executedQty / status / etc.)
 * is only populated on `GET /api/v3/order`. Make every fill field optional so
 * the same schema covers both endpoints.
 *
 * `origQty` is also optional because MEX omits it on BUY-by-quote orders
 * (you submit `quoteOrderQty`, not `quantity`).
 */
/**
 * MEX serializes some optional fields as `null` (e.g. `timeInForce` on market
 * orders) and outright omits others. Accept both shapes uniformly.
 */
const optionalStr = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v) => (v == null ? undefined : String(v)));

export const MexOrderResponseSchema = z
  .object({
    symbol: z.string(),
    orderId: z.union([z.string(), z.number()]).transform((v) => String(v)),
    orderListId: z.number().nullable().optional(),
    clientOrderId: optionalStr,
    price: optionalStr,
    origQty: optionalStr,
    executedQty: optionalStr,
    cummulativeQuoteQty: optionalStr,
    status: optionalStr,
    timeInForce: optionalStr,
    type: optionalStr,
    side: optionalStr,
    transactTime: z.number().nullable().optional(),
  })
  .passthrough();
export type MexOrderResponse = z.infer<typeof MexOrderResponseSchema>;

export const MexTradeSchema = z
  .object({
    symbol: z.string(),
    id: z.union([z.string(), z.number()]).transform(String),
    orderId: z.union([z.string(), z.number()]).transform(String),
    price: z.union([z.string(), z.number()]).transform(String),
    qty: z.union([z.string(), z.number()]).transform(String),
    quoteQty: z.union([z.string(), z.number()]).transform(String),
    commission: z.union([z.string(), z.number()]).transform(String),
    commissionAsset: z.string(),
    time: z.number(),
    isBuyer: z.boolean().optional(),
    isMaker: z.boolean().optional(),
  })
  .passthrough();
export type MexTrade = z.infer<typeof MexTradeSchema>;

export const MexDepositAddressSchema = z.object({
  coin: z.string(),
  network: z.string(),
  address: z.string(),
  memo: z.string().nullable().optional(),
  tag: z.string().nullable().optional(),
});
export type MexDepositAddress = z.infer<typeof MexDepositAddressSchema>;

/**
 * Subset of /api/v3/exchangeInfo per-symbol payload that we care about.
 *
 * MEXC exposes precision in three different ways depending on the era of the
 * docs:
 *  - `baseAssetPrecision` / `quoteAssetPrecision`: integer count of decimals.
 *  - `baseSizePrecision` / `quoteAmountPrecision`: stringified step size
 *    (e.g. "0.000001", "0.01") OR sometimes a digit count as a string.
 *  - `filters[]` of type `LOT_SIZE` / `MIN_NOTIONAL`: classic Binance-style.
 *
 * We accept all three and reconcile in the worker.
 */
export const MexSymbolInfoSchema = z
  .object({
    symbol: z.string(),
    status: z.string().optional(),
    baseAsset: z.string().optional(),
    quoteAsset: z.string().optional(),
    baseAssetPrecision: z.number().int().nonnegative().optional(),
    quoteAssetPrecision: z.number().int().nonnegative().optional(),
    baseSizePrecision: z.union([z.string(), z.number()]).optional(),
    quoteAmountPrecision: z.union([z.string(), z.number()]).optional(),
    quotePrecision: z.number().int().nonnegative().optional(),
    filters: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();
export type MexSymbolInfo = z.infer<typeof MexSymbolInfoSchema>;

export const MexExchangeInfoSchema = z
  .object({
    symbols: z.array(MexSymbolInfoSchema),
  })
  .passthrough();
export type MexExchangeInfo = z.infer<typeof MexExchangeInfoSchema>;

export const MexCapitalConfigEntrySchema = z
  .object({
    coin: z.string(),
    name: z.string().nullable().optional(),
    networkList: z.array(
      z
        .object({
          coin: z.string(),
          network: z.string(),
          /**
           * MEX has two-ish names per network:
           *   - `network`: short id used internally, e.g. "TRX" or "Tron(TRC20)"
           *   - `name`:    pretty name, e.g. "Tron(TRC20)" or "Bitcoin"
           * Withdraw / deposit-address endpoints accept the value of `network`.
           */
          name: z.string().nullable().optional(),
          depositEnable: z.boolean().nullable().optional(),
          withdrawEnable: z.boolean().nullable().optional(),
          withdrawFee: z.string().nullable().optional(),
          withdrawIntegerMultiple: z.string().nullable().optional(),
          withdrawMin: z.string().nullable().optional(),
          withdrawMax: z.string().nullable().optional(),
          contract: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type MexCapitalConfigEntry = z.infer<typeof MexCapitalConfigEntrySchema>;
