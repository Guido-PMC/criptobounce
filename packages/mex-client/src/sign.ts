import { createHmac } from 'node:crypto';

/**
 * MEX-style signing.
 * HMAC-SHA256 hex digest of `<urlencoded params>&timestamp=<ts>`
 * (or `timestamp=<ts>` if no params).
 *
 * IMPORTANT — encoding quirk:
 * MEX network identifiers contain parens, e.g. "Tron(TRC20)", "Bitcoin(BTC)",
 * "Polygon(MATIC)". MEX validates the signature over the PERCENT-ENCODED form
 * (`Tron%28TRC20%29`).
 *
 * encodeURIComponent (RFC 2396) does NOT escape `( ) * ' ! ~`, but RFC 3986
 * and Python's urllib.parse.quote do. We post-process to match the strict
 * encoding MEX expects, otherwise signed-write requests fail with:
 *   400 700002 "Signature for this request is not valid."
 */
export function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*~]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    entries.push([k, String(v)]);
  }
  // MEX accepts insertion order; we don't sort because the Python lib doesn't either.
  return entries.map(([k, v]) => `${strictEncode(k)}=${strictEncode(v)}`).join('&');
}

export function signV3(
  apiSecret: string,
  params: Record<string, string | number | undefined>,
  timestamp: number,
): { signature: string; query: string } {
  const baseQs = buildQueryString(params);
  const toSign = baseQs ? `${baseQs}&timestamp=${timestamp}` : `timestamp=${timestamp}`;
  const signature = createHmac('sha256', apiSecret).update(toSign).digest('hex');
  return { signature, query: `${toSign}&signature=${signature}` };
}
