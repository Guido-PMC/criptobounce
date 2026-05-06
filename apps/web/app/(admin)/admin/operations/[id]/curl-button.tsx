'use client';

import { Button } from '@/components/ui/button';
import type { mexApiCalls } from '@rb/db';

export function CurlButton({ call }: { call: typeof mexApiCalls.$inferSelect }) {
  const buildCurl = () => {
    const params = call.requestParams as Record<string, unknown> | null;
    const qs = params
      ? '?' +
        Object.entries(params)
          .filter(([, v]) => v !== null && v !== undefined && v !== '[REDACTED]')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    const url = `https://api.mexc.com${call.endpoint}${qs}`;
    return `curl -X ${call.method} '${url}' \\
  -H 'X-MEXC-APIKEY: <YOUR_KEY>' \\
  -H 'Content-Type: application/json'
# WARNING: signature & timestamp omitted, regenerate before sending`;
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(buildCurl());
      }}
    >
      copiar cURL
    </Button>
  );
}
