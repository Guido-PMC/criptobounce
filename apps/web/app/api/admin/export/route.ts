import { NextResponse } from 'next/server';
import { and, desc, eq, gte } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { bounceJobs, deposits, users, withdrawals } from '@rb/db';
import { stringify } from 'csv-stringify/sync';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'transactions';

  let csv: string;
  let filename: string;

  switch (type) {
    case 'transactions': {
      const rows = await db
        .select({
          jobId: bounceJobs.id,
          createdAt: bounceJobs.createdAt,
          state: bounceJobs.state,
          telegram: users.telegramUsername,
          email: users.googleEmail,
          asset: deposits.asset,
          network: deposits.network,
          amount: deposits.amount,
          netToUser: bounceJobs.userAmountNet,
          userCommission: bounceJobs.userCommissionAmount,
          platformCommission: bounceJobs.platformCommissionAmount,
          networkFee: bounceJobs.networkFeeEstimated,
          withdrawalNetwork: withdrawals.network,
          onChainTx: withdrawals.onChainTx,
        })
        .from(bounceJobs)
        .innerJoin(deposits, eq(deposits.id, bounceJobs.depositId))
        .innerJoin(users, eq(users.id, deposits.userId))
        .leftJoin(
          withdrawals,
          and(eq(withdrawals.bounceJobId, bounceJobs.id), eq(withdrawals.type, 'user_payout')),
        )
        .orderBy(desc(bounceJobs.createdAt))
        .limit(50_000);
      csv = stringify(
        rows.map((r) => ({
          job_id: r.jobId,
          created_at: r.createdAt?.toISOString(),
          state: r.state,
          user: r.telegram ?? r.email ?? '',
          asset_in: r.asset,
          network_in: r.network,
          amount_in: r.amount,
          net_to_user: r.netToUser ?? '',
          user_commission: r.userCommission ?? '',
          platform_commission: r.platformCommission ?? '',
          network_fee: r.networkFee ?? '',
          network_out: r.withdrawalNetwork ?? '',
          on_chain_tx: r.onChainTx ?? '',
        })),
        { header: true },
      );
      filename = `transactions-${Date.now()}.csv`;
      break;
    }
    case 'revenue': {
      const since = new Date(Date.now() - 365 * 24 * 3600_000);
      const rows = await db
        .select({
          createdAt: bounceJobs.createdAt,
          revenue: bounceJobs.platformCommissionAmount,
          asset: deposits.asset,
          telegram: users.telegramUsername,
        })
        .from(bounceJobs)
        .innerJoin(deposits, eq(deposits.id, bounceJobs.depositId))
        .innerJoin(users, eq(users.id, deposits.userId))
        .where(and(eq(bounceJobs.state, 'done'), gte(bounceJobs.createdAt, since)))
        .orderBy(desc(bounceJobs.createdAt));
      csv = stringify(
        rows.map((r) => ({
          created_at: r.createdAt?.toISOString(),
          asset: r.asset,
          revenue: r.revenue ?? '0',
          user: r.telegram ?? '',
        })),
        { header: true },
      );
      filename = `revenue-${Date.now()}.csv`;
      break;
    }
    case 'users': {
      const rows = await db.select().from(users);
      csv = stringify(
        rows.map((u) => ({
          id: u.id,
          telegram_id: u.telegramId,
          telegram_username: u.telegramUsername,
          google_email: u.googleEmail,
          role: u.role,
          status: u.status,
          is_paused: u.isPaused,
          created_at: u.createdAt?.toISOString(),
          approved_at: u.approvedAt?.toISOString() ?? '',
          deleted_at: u.deletedAt?.toISOString() ?? '',
        })),
        { header: true },
      );
      filename = `users-${Date.now()}.csv`;
      break;
    }
    default:
      return NextResponse.json({ error: 'unknown type' }, { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
