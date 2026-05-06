import Link from 'next/link';
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
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

export const dynamic = 'force-dynamic';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

interface SP {
  method?: string;
  endpoint?: string;
  status?: string;
  q?: string;
  errorsOnly?: string;
  since?: string;
  user?: string;
}

export default async function ApiCallsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;

  const filters = [];
  if (sp.method && HTTP_METHODS.includes(sp.method as (typeof HTTP_METHODS)[number])) {
    filters.push(eq(mexApiCalls.method, sp.method));
  }
  if (sp.endpoint) {
    filters.push(ilike(mexApiCalls.endpoint, `%${sp.endpoint}%`));
  }
  if (sp.status) {
    const n = Number(sp.status);
    if (!Number.isNaN(n)) filters.push(eq(mexApiCalls.responseStatus, n));
  }
  if (sp.errorsOnly === '1') {
    filters.push(or(gte(mexApiCalls.responseStatus, 400), sql`${mexApiCalls.error} is not null`)!);
  }
  if (sp.since) {
    const since = new Date(sp.since);
    if (!Number.isNaN(since.getTime())) filters.push(gte(mexApiCalls.ts, since));
  }
  if (sp.q) {
    const q = sp.q.trim();
    filters.push(
      or(
        eq(mexApiCalls.withdrawOrderId, q),
        ilike(sql`${mexApiCalls.responseBody}::text`, `%${q}%`),
        ilike(sql`${mexApiCalls.requestParams}::text`, `%${q}%`),
      )!,
    );
  }
  if (sp.user) {
    // Filter by operation.user_id via subquery
    const opIds = await db
      .select({ id: operations.id })
      .from(operations)
      .where(eq(operations.userId, sp.user))
      .limit(2000);
    const ids = opIds.map((o) => o.id);
    if (ids.length === 0) {
      // No matching operations → force empty result
      filters.push(sql`false`);
    } else {
      filters.push(sql`${mexApiCalls.operationId} = any(array[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}])`);
    }
  }

  // Default to last 24h if no filter set, to keep page snappy.
  if (!sp.since) {
    filters.push(gte(mexApiCalls.ts, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  }

  const list = await db
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
      operationStatus: operations.status,
      userTelegram: users.telegramUsername,
      userId: users.id,
    })
    .from(mexApiCalls)
    .leftJoin(operations, eq(operations.id, mexApiCalls.operationId))
    .leftJoin(users, eq(users.id, operations.userId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(mexApiCalls.ts))
    .limit(300);

  // Quick aggregates over current filters
  const aggregates = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where coalesce(${mexApiCalls.responseStatus}, 0) >= 400 or ${mexApiCalls.error} is not null)::int`,
      avgMs: sql<number>`coalesce(round(avg(${mexApiCalls.responseMs})::numeric, 0), 0)::int`,
      maxMs: sql<number>`coalesce(max(${mexApiCalls.responseMs}), 0)::int`,
    })
    .from(mexApiCalls)
    .where(filters.length > 0 ? and(...filters) : undefined);

  const agg = aggregates[0] ?? { total: 0, errors: 0, avgMs: 0, maxMs: 0 };

  return (
    <div className="space-y-6 max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight">Llamadas API</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={agg.total.toString()} />
        <StatCard
          label="Errores"
          value={agg.errors.toString()}
          tone={agg.errors > 0 ? 'destructive' : 'default'}
        />
        <StatCard label="Latencia media" value={`${agg.avgMs}ms`} />
        <StatCard label="Pico" value={`${agg.maxMs}ms`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="method">
                Metodo
              </label>
              <select
                id="method"
                name="method"
                defaultValue={sp.method ?? ''}
                className="h-9 w-full border rounded-md px-2 text-sm bg-background"
              >
                <option value="">Todos</option>
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="endpoint">
                Endpoint contiene
              </label>
              <Input
                id="endpoint"
                name="endpoint"
                defaultValue={sp.endpoint ?? ''}
                placeholder="/capital/withdraw"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="status">
                Status
              </label>
              <Input id="status" name="status" defaultValue={sp.status ?? ''} placeholder="200" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="since">
                Desde (ISO)
              </label>
              <Input
                id="since"
                name="since"
                defaultValue={sp.since ?? ''}
                placeholder="2026-05-02T00:00"
              />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <label className="text-xs text-muted-foreground" htmlFor="q">
                Buscar (withdrawOrderId, params, response)
              </label>
              <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="rb-... / TS46QRzr..." />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline">
                Aplicar
              </Button>
              <Button asChild type="button" variant="ghost">
                <Link href="/admin/api-calls?errorsOnly=1">Solo errores</Link>
              </Button>
              <Button asChild type="button" variant="ghost">
                <Link href="/admin/api-calls">Reset</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{list.length} llamadas (max 300)</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay llamadas con esos filtros.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuando</TableHead>
                  <TableHead>Metodo</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latencia</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Operacion</TableHead>
                  <TableHead>withdrawOrderId</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((c) => {
                  const isError = (c.responseStatus ?? 0) >= 400 || !!c.error;
                  return (
                    <TableRow key={c.id} className={isError ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDate(c.ts)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isError ? 'destructive' : 'secondary'}>{c.method}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.endpoint}</TableCell>
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
                      <TableCell className="text-xs">{c.responseMs}ms</TableCell>
                      <TableCell className="text-xs">
                        {c.userTelegram ?? c.userId?.slice(0, 8) ?? (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.operationId ? (
                          <Link
                            href={`/admin/operations/${c.operationId}`}
                            className="font-mono underline"
                          >
                            {c.operationType ?? c.operationId.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground italic">huerfana</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.withdrawOrderId ?? <span className="text-muted-foreground">-</span>}
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
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'destructive';
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`text-2xl font-semibold tabular-nums ${
            tone === 'destructive' ? 'text-destructive' : ''
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
