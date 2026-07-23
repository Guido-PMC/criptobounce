import { requireRevalidatedAdmin } from '@/lib/admin-security';
import { db } from '@/lib/db';
import { buildWebMexClient } from '@/lib/mex-account-client';
import { mexAccounts, mexDepositAddresses } from '@rb/db';
import { ASSETS } from '@rb/domain';
import { buildMexOutputCatalog } from '@rb/mex-client';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  userId: z.string().uuid(),
  fromAsset: z.enum(ASSETS),
  fromNetwork: z.string().trim().min(1).max(100),
});

export async function GET(request: Request) {
  try {
    await requireRevalidatedAdmin();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      userId: url.searchParams.get('userId'),
      fromAsset: url.searchParams.get('fromAsset'),
      fromNetwork: url.searchParams.get('fromNetwork'),
    });
    const mex = await db.query.mexAccounts.findFirst({
      where: and(eq(mexAccounts.userId, query.userId), eq(mexAccounts.status, 'active')),
    });
    if (!mex) {
      return NextResponse.json({ error: 'La cuenta MEX no está activa' }, { status: 404 });
    }
    const client = buildWebMexClient(mex);
    const [exchangeInfo, capital, depositAddress] = await Promise.all([
      client.getExchangeInfo(),
      client.getCapitalConfig(),
      db.query.mexDepositAddresses.findFirst({
        where: and(
          eq(mexDepositAddresses.mexAccountId, mex.id),
          eq(mexDepositAddresses.coin, query.fromAsset),
          eq(mexDepositAddresses.network, query.fromNetwork),
          eq(mexDepositAddresses.status, 'ok'),
        ),
      }),
    ]);
    return NextResponse.json({
      assets: buildMexOutputCatalog(query.fromAsset, exchangeInfo, capital),
      depositDestination: depositAddress?.address
        ? { address: depositAddress.address, memo: depositAddress.memo }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo cargar el catálogo MEX';
    const status = message.includes('admin') || message.includes('autoriz') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
