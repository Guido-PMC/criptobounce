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
import { formatDate } from '@/lib/utils';
import { manualOperations, users } from '@rb/db';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { ManualOperationCountdown } from './manual-operation-countdown';

export const dynamic = 'force-dynamic';

export default async function ManualOperationsPage() {
  const rows = await db
    .select({
      id: manualOperations.id,
      userId: manualOperations.userId,
      username: users.telegramUsername,
      email: users.googleEmail,
      fromAsset: manualOperations.fromAsset,
      fromNetwork: manualOperations.fromNetwork,
      toAsset: manualOperations.toAsset,
      toNetwork: manualOperations.toNetwork,
      expected: manualOperations.expectedDepositAmount,
      state: manualOperations.state,
      expiresAt: manualOperations.expiresAt,
      createdAt: manualOperations.createdAt,
      lastError: manualOperations.lastError,
    })
    .from(manualOperations)
    .innerJoin(users, eq(users.id, manualOperations.userId))
    .orderBy(desc(manualOperations.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operaciones manuales</h1>
        <p className="text-sm text-muted-foreground">
          Revisión operativa, candidatos y controles con step-up TOTP.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Últimas operaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Creada</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Par</TableHead>
                <TableHead>Exacto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Expira</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={row.state === 'pending_admin_confirm' ? 'bg-amber-500/10' : ''}
                >
                  <TableCell className="text-xs">{formatDate(row.createdAt)}</TableCell>
                  <TableCell>
                    <Link className="underline" href={`/admin/users/${row.userId}`}>
                      {row.username ?? row.email ?? row.userId.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.fromAsset}/{row.fromNetwork} → {row.toAsset}/{row.toNetwork}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link className="underline" href={`/admin/manual-operations/${row.id}`}>
                      {row.expected} {row.fromAsset}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={stateVariant(row.state)}>{row.state}</Badge>
                    {row.lastError ? (
                      <div className="mt-1 max-w-52 text-xs text-destructive">{row.lastError}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.state === 'awaiting_deposit' ? (
                      <ManualOperationCountdown expiresAt={row.expiresAt.toISOString()} />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={6}>Sin operaciones manuales.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function stateVariant(state: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (state === 'done') return 'success';
  if (['pending_admin_confirm', 'pending_candidate_resolution', 'on_hold'].includes(state))
    return 'warning';
  if (state === 'failed') return 'destructive';
  return 'secondary';
}
