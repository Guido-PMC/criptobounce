import { randomInt } from 'node:crypto';
import { requireRevalidatedAdmin } from '@/lib/admin-security';
import { db } from '@/lib/db';
import { loadManualQuoteCalculation } from '@/lib/manual-operation-quote';
import { manualOperations } from '@rb/db';
import {
  ASSETS,
  buildExpectedDepositAmount,
  calculateManualEstimatedOutput,
  calculateManualNominalForOutput,
  validateManualNominal,
} from '@rb/domain';
import { and, desc, eq, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  userId: z.string().uuid(),
  fromAsset: z.enum(ASSETS),
  fromNetwork: z.string().trim().min(1).max(100),
  toAsset: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,20}$/),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/)
    .max(40),
  mode: z.enum(['input', 'output']),
  withdrawFee: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/)
    .max(40),
  verifierDigits: z
    .string()
    .trim()
    .regex(/^(0[1-9]|[1-9][0-9])$/)
    .optional(),
});

async function selectVerifier(
  userId: string,
  fromAsset: (typeof ASSETS)[number],
  fromNetwork: string,
  nominal: string,
  requested?: string,
): Promise<{ verifierDigits: string; exactDepositAmount: string }> {
  const recent = await db
    .select({ expected: manualOperations.expectedDepositAmount })
    .from(manualOperations)
    .where(
      and(
        eq(manualOperations.userId, userId),
        eq(manualOperations.fromAsset, fromAsset),
        eq(manualOperations.fromNetwork, fromNetwork),
        gte(manualOperations.createdAt, new Date(Date.now() - 24 * 60 * 60_000)),
      ),
    )
    .orderBy(desc(manualOperations.createdAt));
  const used = new Set(recent.map((row) => row.expected));
  const candidates = requested
    ? [requested, ...Array.from({ length: 99 }, () => String(randomInt(1, 100)).padStart(2, '0'))]
    : Array.from({ length: 99 }, () => String(randomInt(1, 100)).padStart(2, '0'));
  for (const verifierDigits of candidates) {
    const exactDepositAmount = buildExpectedDepositAmount(nominal, verifierDigits, fromAsset);
    if (!used.has(exactDepositAmount)) return { verifierDigits, exactDepositAmount };
  }
  throw new Error('No se pudo generar un monto verificador único');
}

export async function GET(request: Request) {
  try {
    await requireRevalidatedAdmin();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      userId: url.searchParams.get('userId'),
      fromAsset: url.searchParams.get('fromAsset'),
      fromNetwork: url.searchParams.get('fromNetwork'),
      toAsset: url.searchParams.get('toAsset'),
      amount: url.searchParams.get('amount'),
      mode: url.searchParams.get('mode'),
      withdrawFee: url.searchParams.get('withdrawFee'),
      verifierDigits: url.searchParams.get('verifierDigits') || undefined,
    });
    const { quote, calculation } = await loadManualQuoteCalculation(
      query.userId,
      query.fromAsset,
      query.toAsset,
      query.withdrawFee,
    );
    const nominalAmount =
      query.mode === 'input'
        ? validateManualNominal(query.amount, query.fromAsset)
        : calculateManualNominalForOutput(query.amount, query.fromAsset, calculation);
    const estimatedOutput = calculateManualEstimatedOutput(nominalAmount, calculation);
    const verifier = await selectVerifier(
      query.userId,
      query.fromAsset,
      query.fromNetwork,
      nominalAmount,
      query.verifierDigits,
    );
    return NextResponse.json(
      {
        ...verifier,
        nominalAmount,
        estimatedOutput,
        price: String(quote.price),
        symbol: quote.symbol,
        side: quote.side,
        withdrawFee: query.withdrawFee,
        userCommission: calculation.userCommission,
        platformCommission: calculation.platformCommission,
        quotedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo obtener la cotización';
    const status = message.includes('admin') || message.includes('autoriz') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
