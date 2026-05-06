export interface MexCallRecord {
  method: string;
  endpoint: string;
  requestParams: Record<string, unknown>;
  responseStatus?: number;
  responseBody?: unknown;
  responseMs: number;
  error?: string;
  withdrawOrderId?: string;
}

export interface MexTracer {
  /** Persist a single MEX api call. Implementations should redact sensitive fields and truncate. */
  logCall(record: MexCallRecord): Promise<void> | void;
  /** Returns true if this call should be persisted. Default: writes + errors. */
  shouldLog?(record: { method: string; endpoint: string; status?: number }): boolean;
}

export const NoopTracer: MexTracer = {
  logCall: () => {},
};

const REDACT_KEYS = new Set([
  'signature',
  'x-mexc-apikey',
  'apikey',
  'api_secret',
  'apisecret',
  'password',
  'totp_secret',
  'totp',
]);

const MAX_BODY_BYTES = 100 * 1024;

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_BODY_BYTES) {
      return `${value.slice(0, 2000)}...[truncated ${value.length - 2000} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}
