import { and, desc, eq, gte, sql, sum } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bounceJobs, deposits, users } from '@rb/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RevenueChart } from './revenue-chart';

export const dynamic = 'force-dynamic';

export default async function RevenuePage() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600_000);

  const totalSince = (since: Date) =>
    db
      .select({
        revenue: sum(bounceJobs.platformCommissionAmount),
        volume: sum(bounceJobs.userAmountGross),
      })
      .from(bounceJobs)
      .where(and(eq(bounceJobs.state, 'done'), gte(bounceJobs.createdAt, since)));

  const [day] = await totalSince(dayAgo);
  const [week] = await totalSince(weekAgo);
  const [month] = await totalSince(monthAgo);

  const daily = await db.execute<{ day: string; revenue: string }>(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
           COALESCE(SUM(platform_commission_amount), 0)::text AS revenue
    FROM bounce_jobs
    WHERE state = 'done' AND created_at >= ${monthAgo.toISOString()}::timestamptz
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const topUsers = await db
    .select({
      userId: deposits.userId,
      telegram: users.telegramUsername,
      email: users.googleEmail,
      revenue: sum(bounceJobs.platformCommissionAmount),
    })
    .from(bounceJobs)
    .innerJoin(deposits, eq(deposits.id, bounceJobs.depositId))
    .innerJoin(users, eq(users.id, deposits.userId))
    .where(and(eq(bounceJobs.state, 'done'), gte(bounceJobs.createdAt, monthAgo)))
    .groupBy(deposits.userId, users.telegramUsername, users.googleEmail)
    .orderBy(desc(sum(bounceJobs.platformCommissionAmount)))
    .limit(10);

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold">Revenue</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RevenueCard title="Hoy" revenue={day?.revenue} volume={day?.volume} />
        <RevenueCard title="7 dias" revenue={week?.revenue} volume={week?.volume} />
        <RevenueCard title="30 dias" revenue={month?.revenue} volume={month?.volume} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue diario (30 dias)</CardTitle>
        </CardHeader>
        <CardContent>
          <RevenueChart data={(daily as unknown as Array<{ day: string; revenue: string }>).map((r) => ({
            day: r.day,
            revenue: Number(r.revenue),
          }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top usuarios (30d)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topUsers.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell>{u.telegram ?? u.email ?? u.userId.slice(0, 8)}</TableCell>
                  <TableCell className="text-right">{formatNumber(u.revenue ?? 0, 4)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RevenueCard({
  title,
  revenue,
  volume,
}: { title: string; revenue?: string | null; volume?: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle>{formatNumber(revenue ?? 0, 4)}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        Volumen: {formatNumber(volume ?? 0, 2)}
      </CardContent>
    </Card>
  );
}
