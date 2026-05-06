import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { mexAccounts, mexDepositAddresses } from '@rb/db';
import { SUPPORTED_PAIRS } from '@rb/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { CopyButton } from './copy-button';

export const dynamic = 'force-dynamic';

interface AddressRow {
  coin: string;
  network: string;
  status: string;
  address: string | null;
  memo: string | null;
  lastError: string | null;
  fetchedAt: Date | null;
}

export default async function ReceivePage() {
  const session = await auth();
  const userId = session!.user.id;

  const account = await db.query.mexAccounts.findFirst({
    where: eq(mexAccounts.userId, userId),
  });

  if (!account) {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Recibir</h1>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Aun no tenemos tu cuenta vinculada. Pedile a un admin que cargue tus credenciales
            primero.
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = await db
    .select({
      coin: mexDepositAddresses.coin,
      network: mexDepositAddresses.network,
      status: mexDepositAddresses.status,
      address: mexDepositAddresses.address,
      memo: mexDepositAddresses.memo,
      lastError: mexDepositAddresses.lastError,
      fetchedAt: mexDepositAddresses.fetchedAt,
    })
    .from(mexDepositAddresses)
    .where(eq(mexDepositAddresses.mexAccountId, account.id));

  const byPair = new Map<string, AddressRow>();
  for (const r of rows) {
    byPair.set(`${r.coin}:${r.network}`, r);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Recibir</h1>
        <p className="text-sm text-muted-foreground">
          Direcciones de deposito asociadas a tu cuenta. Envia <strong>solo</strong> el activo
          correcto en la red correcta — los depositos cruzados se pierden.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SUPPORTED_PAIRS.map((p) => {
          const row = byPair.get(`${p.asset}:${p.network}`);
          return (
            <AddressCard key={`${p.asset}:${p.network}`} coin={p.asset} network={p.network} row={row} />
          );
        })}
      </div>
    </div>
  );
}

function AddressCard({
  coin,
  network,
  row,
}: {
  coin: string;
  network: string;
  row: AddressRow | undefined;
}) {
  const status = row?.status ?? 'pending';
  const isOk = status === 'ok' && row?.address;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {coin} <span className="text-muted-foreground">/ {network}</span>
          </CardTitle>
          <StatusBadge status={status} />
        </div>
        {row?.fetchedAt ? (
          <CardDescription className="text-xs">
            Sincronizada {formatDate(row.fetchedAt)}
          </CardDescription>
        ) : (
          <CardDescription className="text-xs">Sin sincronizar todavia</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isOk ? (
          <>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Direccion</div>
              <div className="flex items-start gap-2">
                <code className="font-mono text-xs break-all flex-1 bg-muted/50 p-2 rounded">
                  {row!.address}
                </code>
                <CopyButton value={row!.address!} />
              </div>
            </div>
            {row?.memo ? (
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Memo / Tag <span className="text-destructive">(obligatorio)</span>
                </div>
                <div className="flex items-start gap-2">
                  <code className="font-mono text-xs break-all flex-1 bg-muted/50 p-2 rounded">
                    {row.memo}
                  </code>
                  <CopyButton value={row.memo} />
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <PendingState status={status} lastError={row?.lastError} />
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ok')
    return <Badge variant="success">Activa</Badge>;
  if (status === 'generating')
    return <Badge variant="secondary">Generando</Badge>;
  if (status === 'error')
    return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Pendiente</Badge>;
}

function PendingState({ status, lastError }: { status: string; lastError: string | null | undefined }) {
  if (status === 'error') {
    return (
      <div className="text-xs text-destructive">
        {lastError ?? 'Error al obtener la direccion. Reintentaremos automaticamente.'}
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground">
      {status === 'generating'
        ? 'Generando direccion, vuelve en unos segundos.'
        : 'Estamos preparando esta direccion (~1 min). Refresca la pagina en un rato.'}
      {lastError ? <div className="mt-1 text-destructive/80">{lastError}</div> : null}
    </div>
  );
}
