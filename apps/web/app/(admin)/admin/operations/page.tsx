import Link from 'next/link';
import { and, desc, eq, gte, inArray, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { mexApiCalls, operations, users } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { OPERATION_TYPES, OPERATION_STATUSES } from '@rb/domain';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  succeeded: 'success',
  running: 'secondary',
  on_hold: 'warning',
  failed: 'destructive',
};

export default async function OperationsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    status?: string;
    q?: string;
    failedOnly?: string;
  }>;
}) {
  const sp = await searchParams;
  const filters = [];
  if (sp.type && OPERATION_TYPES.includes(sp.type as (typeof OPERATION_TYPES)[number])) {
    filters.push(eq(operations.type, sp.type));
  }
  if (sp.status && OPERATION_STATUSES.includes(sp.status as (typeof OPERATION_STATUSES)[number])) {
    filters.push(eq(operations.status, sp.status));
  }
  if (sp.failedOnly === '1') filters.push(eq(operations.status, 'failed'));

  let candidateOpIds: string[] | null = null;
  if (sp.q) {
    const q = sp.q.trim();
    const calls = await db
      .select({ opId: mexApiCalls.operationId })
      .from(mexApiCalls)
      .where(
        or(eq(mexApiCalls.withdrawOrderId, q), ilike(sql`${mexApiCalls.responseBody}::text`, `%${q}%`)),
      )
      .limit(100);
    candidateOpIds = Array.from(
      new Set(calls.map((c) => c.opId).filter((x): x is string => !!x)),
    );
    // Also try to match by operations.id directly
    candidateOpIds.push(q);
    filters.push(inArray(operations.id, candidateOpIds));
  }

  const list = await db
    .select({
      id: operations.id,
      type: operations.type,
      userId: operations.userId,
      status: operations.status,
      failedAtStep: operations.failedAtStep,
      summary: operations.summary,
      startedAt: operations.startedAt,
      durationMs: operations.durationMs,
      telegram: users.telegramUsername,
    })
    .from(operations)
    .leftJoin(users, eq(users.id, operations.userId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(operations.startedAt))
    .limit(200);

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold">Operaciones</h1>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="type">
                Tipo
              </label>
              <select
                id="type"
                name="type"
                defaultValue={sp.type ?? ''}
                className="h-9 w-full border rounded-md px-2 text-sm bg-background"
              >
                <option value="">Todos</option>
                {OPERATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="status">
                Estado
              </label>
              <select
                id="status"
                name="status"
                defaultValue={sp.status ?? ''}
                className="h-9 w-full border rounded-md px-2 text-sm bg-background"
              >
                <option value="">Todos</option>
                {OPERATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="q">
                Buscar (operation_id, withdraw_order_id, tx hash)
              </label>
              <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="rb-... o 0x..." />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline">
                Aplicar
              </Button>
              <Button asChild type="button" variant="ghost">
                <Link href="/admin/operations?failedOnly=1">Solo failed</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{list.length} operaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fallo en</TableHead>
                <TableHead>Resumen</TableHead>
                <TableHead>Inicio</TableHead>
                <TableHead className="text-right">Duracion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/admin/operations/${o.id}`} className="font-mono text-xs underline">
                      {o.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{o.type}</TableCell>
                  <TableCell>{o.telegram ?? o.userId?.slice(0, 8) ?? '-'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[o.status] ?? 'secondary'}>{o.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-destructive">
                    {o.failedAtStep ?? ''}
                  </TableCell>
                  <TableCell className="text-xs">{o.summary ?? ''}</TableCell>
                  <TableCell className="text-xs">{formatDate(o.startedAt)}</TableCell>
                  <TableCell className="text-right text-xs">
                    {o.durationMs ? `${o.durationMs}ms` : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
