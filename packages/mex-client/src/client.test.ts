import { afterEach, describe, expect, it, vi } from 'vitest';
import { MexClient } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MexClient signed requests', () => {
  it('includes the configured recvWindow in the signed query', async () => {
    const fetchMock = vi.fn(async (_input: unknown) => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new MexClient({
      apiKey: 'key',
      apiSecret: 'secret',
      recvWindow: 60_000,
    });

    await client.getCapitalConfig();

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get('recvWindow')).toBe('60000');
    expect(requestUrl.searchParams.get('timestamp')).toMatch(/^\d{13}$/);
    expect(requestUrl.searchParams.get('signature')).toMatch(/^[a-f0-9]{64}$/);
  });
});
