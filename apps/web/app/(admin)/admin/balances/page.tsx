import { eq, isNull, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { mexAccounts, platformSweepWallet, users } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface BalanceCacheEntry {
  asset: string;
  free: string;
  locked: string;
}

export default async function BalancesPage() {
  const accounts = await db
    .select({
      id: mexAccounts.id,
      mexEmail: mexAccounts.mexEmail,
      lastBalanceSync: mexAccounts.lastBalanceSync,
      balanceCache: mexAccounts.balanceCache,
      status: mexAccounts.status,
      telegram: users.telegramUsername,
      userId: users.id,
    })
    .from(mexAccounts)
    .innerJoin(users, eq(users.id, mexAccounts.userId))
    .where(isNull(users.deletedAt));

  const sweep = await db.query.platformSweepWallet.findFirst({
    where: eq(platformSweepWallet.id, 1),
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold">Balances en vivo</h1>

      <Card>
        <CardHeader>
          <CardTitle>Wallet de sweep</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {sweep ? (
            <div className="space-y-1">
              <div>
                <span className="text-muted-foreground">{sweep.asset} en {sweep.network}: </span>
                <span className="font-mono break-all">{sweep.address}</span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No configurada. Insertar en BD.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cuentas de exchange</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ultima sync</TableHead>
                <TableHead>Balances (free)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const balances = (a.balanceCache as BalanceCacheEntry[] | null) ?? [];
                const nonzero = balances.filter((b) => Number(b.free) > 0 || Number(b.locked) > 0);
                return (
                  <TableRow key={a.id}>
                    <TableCell>{a.telegram ?? a.userId.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">{a.mexEmail}</TableCell>
                    <TableCell>{a.status}</TableCell>
                    <TableCell>{a.lastBalanceSync ? formatDate(a.lastBalanceSync) : '-'}</TableCell>
                    <TableCell className="text-xs">
                      {nonzero.length === 0 ? (
                        <span className="text-muted-foreground">vacio</span>
                      ) : (
                        nonzero.map((b) => (
                          <div key={b.asset}>
                            {b.asset}: {formatNumber(b.free, 8)}{' '}
                            {Number(b.locked) > 0 ? <span className="text-yellow-600">(locked: {b.locked})</span> : null}
                          </div>
                        ))
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
