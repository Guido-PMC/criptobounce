import { ManualOperationDialog } from '@/components/manual-operation-dialog';
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
import { formatDate, formatNumber } from '@/lib/utils';
import {
  destinationWallets,
  mexAccounts,
  mexApiCalls,
  operations,
  userCommissions,
  users,
} from '@rb/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminUserActions } from './admin-actions';
import { ApproveForm } from './approve-form';
import { CommissionEditor } from './commission-editor';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) notFound();

  const mex = await db.query.mexAccounts.findFirst({ where: eq(mexAccounts.userId, id) });
  const wallets = await db
    .select({
      id: destinationWallets.id,
      label: destinationWallets.label,
      asset: destinationWallets.asset,
      network: destinationWallets.network,
      address: destinationWallets.address,
    })
    .from(destinationWallets)
    .where(and(eq(destinationWallets.userId, id), isNull(destinationWallets.deletedAt)));

  // Latest operations for this user (any type)
  const ops = await db
    .select({
      id: operations.id,
      type: operations.type,
      status: operations.status,
      summary: operations.summary,
      startedAt: operations.startedAt,
      durationMs: operations.durationMs,
      failedAtStep: operations.failedAtStep,
    })
    .from(operations)
    .where(eq(operations.userId, id))
    .orderBy(desc(operations.startedAt))
    .limit(15);

  // Latest external API calls for this user (joined via operations.user_id)
  const calls = await db
    .select({
      id: mexApiCalls.id,
      ts: mexApiCalls.ts,
      method: mexApiCalls.method,
      endpoint: mexApiCalls.endpoint,
      responseStatus: mexApiCalls.responseStatus,
      responseMs: mexApiCalls.responseMs,
      error: mexApiCalls.error,
      withdrawOrderId: mexApiCalls.withdrawOrderId,
      operationId: mexApiCalls.operationId,
      operationType: operations.type,
    })
    .from(mexApiCalls)
    .innerJoin(operations, eq(operations.id, mexApiCalls.operationId))
    .where(eq(operations.userId, id))
    .orderBy(desc(mexApiCalls.ts))
    .limit(20);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{user.telegramUsername ?? 'usuario'}</h1>
        <Badge
          variant={
            user.status === 'approved'
              ? 'success'
              : user.status === 'pending'
                ? 'warning'
                : 'destructive'
          }
        >
          {user.status}
        </Badge>
        <div className="ml-auto">
          <ManualOperationDialog
            userId={user.id}
            wallets={wallets}
            disabled={user.status !== 'approved' || mex?.status !== 'active'}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la cuenta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="ID" value={user.id} mono />
          <Row label="Telegram ID" value={String(user.telegramId ?? '-')} mono />
          <Row label="Telegram username" value={user.telegramUsername ?? '-'} />
          <Row label="Google email" value={user.googleEmail ?? '(sin asignar)'} />
          <Row label="Rol" value={user.role} />
          <Row label="Creado" value={formatDate(user.createdAt)} />
          <Row label="Aprobado" value={user.approvedAt ? formatDate(user.approvedAt) : '-'} />
        </CardContent>
      </Card>

      {user.status === 'pending' ? (
        <Card>
          <CardHeader>
            <CardTitle>Aprobar y vincular cuenta de exchange</CardTitle>
          </CardHeader>
          <CardContent>
            <ApproveForm userId={user.id} alreadyHasMex={Boolean(mex)} />
          </CardContent>
        </Card>
      ) : mex ? (
        <Card>
          <CardHeader>
            <CardTitle>Cuenta de exchange vinculada</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Email" value={mex.mexEmail} />
            <Row label="IP whitelisted" value={mex.ipWhitelisted} />
            <Row label="Status" value={mex.status} />
            <Row
              label="Last balance sync"
              value={mex.lastBalanceSync ? formatDate(mex.lastBalanceSync) : '-'}
            />
          </CardContent>
        </Card>
      ) : null}

      {user.status === 'approved' || user.status === 'suspended' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Comisiones del usuario</CardTitle>
            </CardHeader>
            <CardContent>
              <CommissionEditor userId={user.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acciones admin</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminUserActions
                userId={user.id}
                status={user.status}
                hasMexAccount={Boolean(mex)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Operaciones recientes</CardTitle>
            </CardHeader>
            <CardContent>
              {ops.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin operaciones aun.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cuando</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Resumen</TableHead>
                      <TableHead className="text-right">Duracion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ops.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDate(o.startedAt)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Link href={`/admin/operations/${o.id}`} className="underline">
                            {o.type}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              o.status === 'succeeded'
                                ? 'success'
                                : o.status === 'failed'
                                  ? 'destructive'
                                  : o.status === 'on_hold'
                                    ? 'warning'
                                    : 'secondary'
                            }
                          >
                            {o.status}
                          </Badge>
                          {o.failedAtStep ? (
                            <span className="ml-2 text-xs text-destructive">{o.failedAtStep}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">{o.summary ?? '-'}</TableCell>
                        <TableCell className="text-right text-xs">
                          {o.durationMs ? `${o.durationMs}ms` : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Llamadas API recientes</CardTitle>
                <Link
                  className="text-xs underline text-muted-foreground"
                  href={`/admin/api-calls?user=${user.id}`}
                >
                  ver todas
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {calls.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin llamadas registradas aun.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cuando</TableHead>
                      <TableHead>Metodo</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Latencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map((c) => {
                      const isError = (c.responseStatus ?? 0) >= 400 || !!c.error;
                      return (
                        <TableRow key={c.id} className={isError ? 'bg-destructive/5' : ''}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatDate(c.ts)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={isError ? 'destructive' : 'secondary'}>
                              {c.method}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {c.operationId ? (
                              <Link
                                href={`/admin/operations/${c.operationId}`}
                                className="underline"
                              >
                                {c.endpoint}
                              </Link>
                            ) : (
                              c.endpoint
                            )}
                          </TableCell>
                          <TableCell>
                            {c.responseStatus ? (
                              <Badge variant={isError ? 'destructive' : 'success'}>
                                {c.responseStatus}
                              </Badge>
                            ) : c.error ? (
                              <Badge variant="destructive">net</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs">{c.responseMs}ms</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="w-40 text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono break-all' : ''}>{value}</span>
    </div>
  );
}
