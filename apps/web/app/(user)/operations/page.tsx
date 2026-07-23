import { auth } from '@/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/db';
import { ACTIVE_MANUAL_OPERATION_STATES } from '@/lib/user-manual-operations';
import { formatDate } from '@/lib/utils';
import { manualOperations, mexDepositAddresses, withdrawals } from '@rb/db';
import { type Network, explorerTxUrl } from '@rb/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ConfirmOperationButton } from './confirm-operation-button';

export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<string, string> = {
  awaiting_deposit: 'Esperando depósito',
  awaiting_deposit_confirmation: 'Confirmando depósito',
  pending_user_confirm: 'Esperando tu confirmación',
  pending_admin_confirm: 'En revisión del admin',
  pending_candidate_resolution: 'Resolviendo depósitos adicionales',
  converting: 'Convirtiendo',
  awaiting_conversion: 'Confirmando conversión',
  withdrawing: 'Preparando retiro',
  awaiting_withdrawal: 'Confirmando retiro',
  refunding: 'Preparando devolución',
  awaiting_refund: 'Confirmando devolución',
  on_hold: 'En revisión',
  done: 'Completada',
  failed: 'Fallida',
  expired: 'Expirada',
  cancelled: 'Cancelada',
};

function stateVariant(state: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (state === 'done') return 'success';
  if (state === 'failed' || state === 'cancelled') return 'destructive';
  if (state.startsWith('pending_') || state === 'on_hold') return 'warning';
  return 'secondary';
}

export default async function OperationsPage() {
  const session = await auth();
  const userId = session!.user.id;
  const operations = await db
    .select()
    .from(manualOperations)
    .where(eq(manualOperations.userId, userId))
    .orderBy(desc(manualOperations.createdAt))
    .limit(100);

  const active = operations.find((operation) =>
    (ACTIVE_MANUAL_OPERATION_STATES as readonly string[]).includes(operation.state),
  );
  const [depositAddress, operationWithdrawals] = await Promise.all([
    active
      ? db.query.mexDepositAddresses.findFirst({
          where: and(
            eq(mexDepositAddresses.mexAccountId, active.mexAccountId),
            eq(mexDepositAddresses.coin, active.fromAsset),
            eq(mexDepositAddresses.network, active.fromNetwork),
            eq(mexDepositAddresses.status, 'ok'),
          ),
        })
      : Promise.resolve(undefined),
    operations.length
      ? db
          .select()
          .from(withdrawals)
          .where(
            and(
              eq(withdrawals.userId, userId),
              inArray(
                withdrawals.manualOperationId,
                operations.map((operation) => operation.id),
              ),
            ),
          )
          .orderBy(desc(withdrawals.createdAt))
      : Promise.resolve([]),
  ]);
  const withdrawalsByOperation = new Map<string, typeof operationWithdrawals>();
  for (const withdrawal of operationWithdrawals) {
    if (!withdrawal.manualOperationId) continue;
    const current = withdrawalsByOperation.get(withdrawal.manualOperationId) ?? [];
    current.push(withdrawal);
    withdrawalsByOperation.set(withdrawal.manualOperationId, current);
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operaciones manuales</h1>
        <p className="text-sm text-muted-foreground">
          Seguimiento de depósitos, conversiones y retiros coordinados con el equipo.
        </p>
      </div>

      {active ? (
        <Card className={active.state === 'pending_user_confirm' ? 'border-yellow-500/60' : ''}>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Operación activa</CardTitle>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{active.id}</p>
            </div>
            <Badge variant={stateVariant(active.state)}>
              {STATE_LABELS[active.state] ?? active.state}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Datum
                label="Monto exacto"
                value={`${active.expectedDepositAmount} ${active.fromAsset}`}
                strong
              />
              <Datum label="Red de depósito" value={active.fromNetwork} />
              <Datum label="Destino" value={`${active.toAsset} (${active.toNetwork})`} />
              <Datum
                label="Estimado al crear"
                value={`${active.estimatedOutput ?? '—'} ${active.toAsset}`}
              />
              <Datum
                label="Dirección de depósito"
                value={depositAddress?.address ?? 'No disponible'}
                mono
              />
              <Datum label="Memo/tag" value={depositAddress?.memo ?? '—'} mono />
              <Datum
                label="Monto recibido"
                value={`${active.receivedAmount ?? '—'} ${active.fromAsset}`}
              />
              <Datum
                label="Monto a ejecutar"
                value={`${active.amountToExecute ?? '—'} ${active.fromAsset}`}
              />
              <Datum
                label="Excedente"
                value={`${active.surplusAmount ?? '—'} ${active.surplusAsset ?? active.fromAsset}`}
              />
              <Datum
                label="Salida ejecutada"
                value={`${active.executedOutput ?? '—'} ${active.toAsset}`}
              />
              <Datum
                label="Conversión"
                value={
                  active.spotSymbol ? `${active.spotSymbol} · ${active.spotSide}` : 'Sin conversión'
                }
              />
              <Datum label="Orden MEX" value={active.conversionOrderId ?? '—'} mono />
              <Datum label="Quote de confirmación" value={active.confirmationQuote ?? '—'} />
              <Datum label="Precio promedio" value={active.averageFillPrice ?? '—'} />
              <Datum label="Creada" value={formatDate(active.createdAt)} />
              <Datum label="Actualizada" value={formatDate(active.updatedAt)} />
            </div>

            {active.state === 'pending_user_confirm' ? (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 space-y-3">
                <div>
                  <h2 className="font-medium">Depósito exacto recibido</h2>
                  <p className="text-sm text-muted-foreground">
                    Confirmá para ejecutar el monto nominal de {active.nominalAmount}{' '}
                    {active.fromAsset}. La conversión se hará a mercado con una cotización nueva.
                  </p>
                </div>
                <ConfirmOperationButton operationId={active.id} />
              </div>
            ) : null}

            <WithdrawalDetails withdrawals={withdrawalsByOperation.get(active.id) ?? []} />
            {active.state === 'on_hold' && active.lastError ? (
              <p className="rounded-md bg-yellow-500/10 p-3 text-sm">
                La operación está en revisión: {active.lastError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No tenés una operación manual activa.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          {operations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay operaciones.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Par</TableHead>
                  <TableHead>Monto exacto</TableHead>
                  <TableHead>Recibido</TableHead>
                  <TableHead>Salida</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Retiro / tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.map((operation) => {
                  const related = withdrawalsByOperation.get(operation.id) ?? [];
                  return (
                    <TableRow key={operation.id}>
                      <TableCell>{formatDate(operation.createdAt)}</TableCell>
                      <TableCell>
                        {operation.fromAsset}/{operation.fromNetwork} → {operation.toAsset}/
                        {operation.toNetwork}
                      </TableCell>
                      <TableCell className="font-mono">
                        {operation.expectedDepositAmount} {operation.fromAsset}
                      </TableCell>
                      <TableCell>{operation.receivedAmount ?? '—'}</TableCell>
                      <TableCell>
                        {operation.executedOutput
                          ? `${operation.executedOutput} ${operation.toAsset}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={stateVariant(operation.state)}>
                          {STATE_LABELS[operation.state] ?? operation.state}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <WithdrawalLinks withdrawals={related} />
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

function Datum({
  label,
  value,
  mono,
  strong,
}: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`${mono ? 'break-all font-mono' : ''} ${strong ? 'text-lg font-semibold' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function WithdrawalDetails({
  withdrawals: rows,
}: { withdrawals: Array<typeof withdrawals.$inferSelect> }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-2 border-t pt-4">
      <h2 className="font-medium">Retiros</h2>
      {rows.map((withdrawal) => (
        <div
          key={withdrawal.id}
          className="grid gap-2 rounded-md bg-secondary/40 p-3 text-sm sm:grid-cols-4"
        >
          <Datum
            label={withdrawal.type === 'manual_operation_refund' ? 'Devolución' : 'Payout'}
            value={`${withdrawal.amount} ${withdrawal.asset}`}
          />
          <Datum label="Estado" value={withdrawal.status} />
          <Datum
            label="ID MEX"
            value={withdrawal.mexWithdrawId ?? withdrawal.withdrawOrderId}
            mono
          />
          <Datum label="Tx" value={withdrawal.onChainTx ?? '—'} mono />
        </div>
      ))}
    </div>
  );
}

function WithdrawalLinks({
  withdrawals: rows,
}: { withdrawals: Array<typeof withdrawals.$inferSelect> }) {
  if (!rows.length) return <>—</>;
  return (
    <div className="space-y-1 text-xs">
      {rows.map((withdrawal) => {
        const url = withdrawal.onChainTx
          ? explorerTxUrl(withdrawal.network as Network, withdrawal.onChainTx)
          : null;
        return (
          <div key={withdrawal.id}>
            {withdrawal.type === 'manual_operation_refund' ? 'Devolución' : 'Payout'}:{' '}
            {withdrawal.status}
            {url ? (
              <>
                {' · '}
                <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">
                  ver tx
                </a>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
