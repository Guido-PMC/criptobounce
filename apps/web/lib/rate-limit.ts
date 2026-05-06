/**
 * Lightweight in-memory rate limiter (per-process).
 * Not suitable for multi-replica setups; replace with @upstash/ratelimit or
 * a Postgres-backed limiter if scaling out.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitOptions {
  /** unique key (IP, user id, route) */
  key: string;
  /** max requests per window */
  max: number;
  /** window length in ms */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(opts.key);
  if (!b || b.resetAt <= now) {
    buckets.set(opts.key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, remaining: opts.max - 1, resetIn: opts.windowMs };
  }
  b.count += 1;
  if (b.count > opts.max) {
    return { allowed: false, remaining: 0, resetIn: b.resetAt - now };
  }
  return { allowed: true, remaining: opts.max - b.count, resetIn: b.resetAt - now };
}

// Simple janitor to keep the map bounded
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
}, 60_000).unref?.();
