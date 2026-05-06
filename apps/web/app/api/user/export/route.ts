import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { bounceJobs, deposits, withdrawals } from '@rb/db';
import { stringify } from 'csv-stringify/sync';

export const dynamic = 'force-dynamic';

function csvState(depositStatus: string, jobState: string | null): string {
  if (jobState) return jobState;
  if (depositStatus === 'detected') return 'esperando_confirmaciones';
  return 'pendiente';
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const rows = await db
    .select({
      depositId: deposits.id,
      detectedAt: deposits.detectedAt,
      depositStatus: deposits.status,
      asset: deposits.asset,
      network: deposits.network,
      amount: deposits.amount,
      jobId: bounceJobs.id,
      jobState: bounceJobs.state,
      userAmountNet: bounceJobs.userAmountNet,
      userCommissionAmount: bounceJobs.userCommissionAmount,
      withdrawalNetwork: withdrawals.network,
      withdrawalOnChainTx: withdrawals.onChainTx,
    })
    .from(deposits)
    .leftJoin(bounceJobs, eq(bounceJobs.depositId, deposits.id))
    .leftJoin(
      withdrawals,
      and(eq(withdrawals.bounceJobId, bounceJobs.id), eq(withdrawals.type, 'user_payout')),
    )
    .where(eq(deposits.userId, userId))
    .orderBy(desc(deposits.detectedAt));

  const csv = stringify(
    rows.map((r) => ({
      id: r.jobId ?? r.depositId,
      created_at: r.detectedAt?.toISOString(),
      state: csvState(r.depositStatus, r.jobState),
      asset_in: r.asset,
      network_in: r.network,
      amount_in: r.amount,
      commission: r.userCommissionAmount ?? '',
      amount_net: r.userAmountNet ?? '',
      network_out: r.withdrawalNetwork ?? '',
      on_chain_tx: r.withdrawalOnChainTx ?? '',
    })),
    { header: true },
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="transactions-${userId}-${Date.now()}.csv"`,
    },
  });
}
