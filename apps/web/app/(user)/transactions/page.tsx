import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { bounceJobs, deposits, withdrawals } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatNumber } from '@/lib/utils';
import { explorerTxUrl, isReceiptEligible, type Network } from '@rb/domain';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

const STATE_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  done: 'success',
  failed: 'destructive',
  on_hold: 'warning',
  esperando_confirmaciones: 'warning',
  pendiente: 'secondary',
};

function displayState(
  depositStatus: string,
  jobState: string | null,
): { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' } {
  if (jobState) {
    return { label: jobState, variant: STATE_VARIANT[jobState] ?? 'secondary' };
  }
  if (depositStatus === 'detected') {
    return { label: 'esperando_confirmaciones', variant: 'warning' };
  }
  return { label: 'pendiente', variant: 'secondary' };
}

export default async function TransactionsPage() {
  const session = await auth();
  const userId = session!.user.id;

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
      withdrawalAsset: withdrawals.asset,
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
    .orderBy(desc(deposits.detectedAt))
    .limit(200);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Transacciones</h1>
        <Button asChild variant="outline" size="sm">
          <a href="/api/user/export?type=transactions" download>
            Exportar CSV
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay transacciones aun.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Recibido</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Comision</TableHead>
                  <TableHead className="text-right">Neto enviado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Tx</TableHead>
                  <TableHead>Comprobante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const explorer =
                    r.withdrawalOnChainTx && r.withdrawalNetwork
                      ? explorerTxUrl(r.withdrawalNetwork as Network, r.withdrawalOnChainTx)
                      : null;
                  const state = displayState(r.depositStatus, r.jobState);
                  // Comprobante is offered only for completed bounces with a
                  // real exchange (deposit asset != payout asset). Same-asset
                  // bounces have no rate to render so we hide the link.
                  const showReceipt =
                    r.jobId !== null &&
                    r.jobState === 'done' &&
                    r.withdrawalAsset !== null &&
                    isReceiptEligible(r.asset, r.withdrawalAsset);
                  return (
                    <TableRow key={r.depositId}>
                      <TableCell>{formatDate(r.detectedAt)}</TableCell>
                      <TableCell>
                        {r.asset} ({r.network})
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(r.amount)}</TableCell>
                      <TableCell className="text-right">
                        {formatNumber(r.userCommissionAmount)}
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(r.userAmountNet)}</TableCell>
                      <TableCell>
                        <Badge variant={state.variant}>{state.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {explorer ? (
                          <a
                            href={explorer}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline text-xs"
                          >
                            ver
                          </a>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {showReceipt ? (
                          <Link
                            href={`/transactions/${r.jobId}/comprobante`}
                            className="text-primary underline text-xs"
                          >
                            ver
                          </Link>
                        ) : (
                          '-'
                        )}
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
