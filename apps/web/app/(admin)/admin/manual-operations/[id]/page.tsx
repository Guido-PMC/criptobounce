import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/utils';
import { manualOperationDeposits, manualOperations, mexDepositAddresses, users } from '@rb/db';
import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import {
  cancelManualOperationAction,
  confirmMismatchAction,
  extendManualOperationAction,
  rejectManualOperationAction,
  releaseCandidateToBounceAction,
  retryManualOperationAction,
} from '../actions';
import { ManualOperationCountdown } from '../manual-operation-countdown';

export const dynamic = 'force-dynamic';

export default async function ManualOperationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const op = await db.query.manualOperations.findFirst({ where: eq(manualOperations.id, id) });
  if (!op) notFound();
  const [user, address, candidates] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, op.userId) }),
    db.query.mexDepositAddresses.findFirst({
      where: and(
        eq(mexDepositAddresses.mexAccountId, op.mexAccountId),
        eq(mexDepositAddresses.coin, op.fromAsset),
        eq(mexDepositAddresses.network, op.fromNetwork),
      ),
    }),
    db
      .select()
      .from(manualOperationDeposits)
      .where(eq(manualOperationDeposits.manualOperationId, op.id))
      .orderBy(asc(manualOperationDeposits.createdAt)),
  ]);

  const canCancel = [
    'awaiting_deposit',
    'awaiting_deposit_confirmation',
    'pending_user_confirm',
    'pending_admin_confirm',
  ].includes(op.state);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Operación manual</h1>
          <p className="font-mono text-xs text-muted-foreground">{op.id}</p>
        </div>
        <Badge
          variant={
            op.state === 'done'
              ? 'success'
              : op.state.includes('pending') || op.state === 'on_hold'
                ? 'warning'
                : 'secondary'
          }
        >
          {op.state}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Instrucciones de depósito</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Datum label="Usuario" value={user?.telegramUsername ?? user?.googleEmail ?? op.userId} />
          <Datum label="Creada" value={formatDate(op.createdAt)} />
          <Datum label="Monto nominal" value={`${op.nominalAmount} ${op.fromAsset}`} mono />
          <Datum
            label="Monto exacto"
            value={`${op.expectedDepositAmount} ${op.fromAsset}`}
            mono
            strong
          />
          <Datum label="Código verificador" value={op.verifierDigits} mono />
          <div>
            <div className="text-xs text-muted-foreground">Expira</div>
            {op.state === 'awaiting_deposit' ? (
              <ManualOperationCountdown expiresAt={op.expiresAt.toISOString()} />
            ) : (
              <div>{formatDate(op.expiresAt)}</div>
            )}
          </div>
          <Datum label="Dirección MEX" value={address?.address ?? 'No disponible'} mono />
          <Datum label="Memo/tag" value={address?.memo ?? '—'} mono />
          <Datum label="Destino" value={`${op.toAsset}/${op.toNetwork}`} />
          <Datum
            label="Estimado al crear"
            value={`${op.estimatedOutput ?? '—'} ${op.toAsset}`}
            mono
          />
          <Datum label="Wallet payout" value={op.payoutAddress} mono />
          <Datum label="Memo payout" value={op.payoutMemo ?? '—'} mono />
          <Datum
            label="Wallet devolución"
            value={op.refundAddress ?? 'Fondos quedan en MEX'}
            mono
          />
          <Datum
            label="Spot"
            value={op.spotSymbol ? `${op.spotSymbol} ${op.spotSide}` : 'Sin conversión'}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Montos y ejecución</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <Datum label="Recibido" value={op.receivedAmount ?? '—'} mono />
          <Datum label="A ejecutar" value={op.amountToExecute ?? '—'} mono />
          <Datum label="Surplus" value={op.surplusAmount ?? '—'} mono />
          <Datum label="Quote confirmación" value={op.confirmationQuote ?? '—'} mono />
          <Datum label="Output bruto" value={op.convertedAmountGross ?? '—'} mono />
          <Datum label="Output ejecutado" value={op.executedOutput ?? '—'} mono />
          <Datum label="Resume state" value={op.resumeState ?? '—'} />
          <Datum label="Retries" value={String(op.retryCount)} />
          <Datum label="Error" value={op.lastError ?? '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Candidatos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Monto</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Insertado</TableHead>
                <TableHead>Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((candidate) => (
                <TableRow key={candidate.id}>
                  <TableCell className="font-mono">
                    {candidate.sourceAmountRaw} {op.fromAsset}
                  </TableCell>
                  <TableCell>{candidate.matchType}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{candidate.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatDate(candidate.sourceInsertedAt)}
                  </TableCell>
                  <TableCell>
                    {op.state === 'pending_admin_confirm' &&
                    candidate.matchType === 'mismatch' &&
                    ['candidate', 'selected'].includes(candidate.status) ? (
                      <form
                        action={confirmMismatchAction.bind(null, op.id)}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="candidateId" value={candidate.id} />
                        <CompactInput
                          name="amountToExecute"
                          label="A ejecutar"
                          defaultValue={candidate.sourceAmountRaw}
                        />
                        <CompactInput
                          name="maxSlippageBps"
                          label="Slippage bps"
                          defaultValue="200"
                        />
                        <CompactInput name="totpCode" label="TOTP" />
                        <Button size="sm">Seleccionar y confirmar</Button>
                      </form>
                    ) : ['pending_candidate_resolution', 'cancelled', 'done'].includes(op.state) &&
                      ['candidate', 'rejected'].includes(candidate.status) ? (
                      <form
                        action={releaseCandidateToBounceAction.bind(null, candidate.id)}
                        className="flex items-end gap-2"
                      >
                        <CompactInput name="totpCode" label="TOTP" />
                        <Button size="sm" variant="outline">
                          Liberar a bounce
                        </Button>
                      </form>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!candidates.length ? (
                <TableRow>
                  <TableCell colSpan={5}>Sin depósitos candidatos.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controles admin</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          {op.state === 'expired' && candidates.length === 0 ? (
            <ActionForm
              action={extendManualOperationAction.bind(null, op.id)}
              title="Extender como nueva operación"
              button="Crear nueva"
            />
          ) : null}
          {canCancel ? (
            <ActionForm
              action={cancelManualOperationAction.bind(null, op.id)}
              title="Cancelar pre-ejecución"
              button="Cancelar"
              reason
            />
          ) : null}
          {op.state === 'pending_admin_confirm' ? (
            <ActionForm
              action={rejectManualOperationAction.bind(null, op.id)}
              title="Rechazar depósito"
              button="Rechazar"
              reason
            />
          ) : null}
          {op.state === 'on_hold' ? (
            <ActionForm
              action={retryManualOperationAction.bind(null, op.id)}
              title={`Reintentar hacia ${op.resumeState ?? '—'}`}
              button="Reintentar"
            />
          ) : null}
          {!canCancel &&
          op.state !== 'expired' &&
          op.state !== 'pending_admin_confirm' &&
          op.state !== 'on_hold' ? (
            <p className="text-sm text-muted-foreground">
              No hay transiciones manuales disponibles en este estado.
            </p>
          ) : null}
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
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`${mono ? 'font-mono break-all' : ''} ${strong ? 'text-lg font-semibold' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function CompactInput({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <Label className="w-32 space-y-1 text-xs">
      <span>{label}</span>
      <Input
        name={name}
        defaultValue={defaultValue}
        required
        maxLength={name === 'totpCode' ? 6 : undefined}
      />
    </Label>
  );
}

function ActionForm({
  action,
  title,
  button,
  reason,
}: {
  action: (formData: FormData) => void | Promise<void>;
  title: string;
  button: string;
  reason?: boolean;
}) {
  return (
    <form action={action} className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">{title}</h3>
      {reason ? <Input name="reason" placeholder="Motivo" required /> : null}
      <Input
        name="totpCode"
        placeholder="TOTP de 6 dígitos"
        pattern="[0-9]{6}"
        maxLength={6}
        required
      />
      <Button variant={button === 'Rechazar' || button === 'Cancelar' ? 'destructive' : 'default'}>
        {button}
      </Button>
    </form>
  );
}
