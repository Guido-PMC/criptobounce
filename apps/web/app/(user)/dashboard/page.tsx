import { and, desc, eq, gte, sum } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { bounceJobs, deposits, mexAccounts } from '@rb/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
// CardTitle is used by the recent-transactions card below.
import { Badge } from '@/components/ui/badge';
import { PricesCard } from '@/components/prices-card';
import { formatNumber, formatDate } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

const STATE_LABEL: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  done: { label: 'completada', variant: 'success' },
  failed: { label: 'fallida', variant: 'destructive' },
  on_hold: { label: 'en espera', variant: 'warning' },
  esperando_confirmaciones: { label: 'esperando confirmaciones', variant: 'warning' },
  pendiente: { label: 'pendiente', variant: 'secondary' },
};

function stateBadge(state: string) {
  return STATE_LABEL[state] ?? { label: state, variant: 'secondary' as const };
}

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [monthly] = await db
    .select({
      total: sum(bounceJobs.userAmountNet),
      count: sum(bounceJobs.userAmountNet),
    })
    .from(bounceJobs)
    .innerJoin(deposits, eq(deposits.id, bounceJobs.depositId))
    .where(
      and(
        eq(deposits.userId, userId),
        eq(bounceJobs.state, 'done'),
        gte(bounceJobs.createdAt, monthStart),
      ),
    );

  const recent = await db
    .select({
      depositId: deposits.id,
      depositStatus: deposits.status,
      detectedAt: deposits.detectedAt,
      jobState: bounceJobs.state,
      amount: deposits.amount,
      userAmountNet: bounceJobs.userAmountNet,
      asset: deposits.asset,
      network: deposits.network,
    })
    .from(deposits)
    .leftJoin(bounceJobs, eq(bounceJobs.depositId, deposits.id))
    .where(eq(deposits.userId, userId))
    .orderBy(desc(deposits.detectedAt))
    .limit(5);

  const account = await db.query.mexAccounts.findFirst({
    where: eq(mexAccounts.userId, userId),
  });

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Resumen de tu actividad y precios en vivo.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard label="Recibido este mes" highlight>
          <div className="text-2xl font-semibold tabular-nums">
            {formatNumber(monthly?.total ?? 0, 4)}
            <span className="text-sm text-muted-foreground ml-1.5 font-normal">
              USDT
            </span>
          </div>
        </StatCard>

        <StatCard label="Ultima sincronizacion">
          <div className="text-base font-medium">
            {account?.lastBalanceSync ? formatDate(account.lastBalanceSync) : 'pendiente'}
          </div>
        </StatCard>
      </div>

      <PricesCard isAdmin={session!.user.role === 'admin'} />

      <Card>
        <CardHeader>
          <CardTitle>Ultimas transacciones</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aun no hay transacciones. En cuanto detectemos un deposito en tu cuenta, lo veras
              aca.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Red</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => {
                  const stateKey =
                    r.jobState ??
                    (r.depositStatus === 'detected' ? 'esperando_confirmaciones' : 'pendiente');
                  const s = stateBadge(stateKey);
                  return (
                    <TableRow key={r.depositId}>
                      <TableCell>{formatDate(r.detectedAt)}</TableCell>
                      <TableCell className="font-medium">{r.asset}</TableCell>
                      <TableCell className="text-muted-foreground">{r.network}</TableCell>
                      <TableCell>
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(r.amount, 8)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(r.userAmountNet, 8)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  children,
  highlight = false,
}: {
  label: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card
      className={
        highlight
          ? 'bg-gradient-to-br from-card to-accent/40 border-border/70'
          : ''
      }
    >
      <CardHeader>
        <CardDescription className="text-xs uppercase tracking-wider">
          {label}
        </CardDescription>
        {children}
      </CardHeader>
    </Card>
  );
}
