import { eq, asc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { mexApiCalls, operations, traceEvents } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { JsonViewer } from './json-viewer';
import { CurlButton } from './curl-button';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  succeeded: 'success',
  running: 'secondary',
  on_hold: 'warning',
  failed: 'destructive',
};

const LEVEL_VARIANT: Record<string, 'secondary' | 'warning' | 'destructive'> = {
  debug: 'secondary',
  info: 'secondary',
  warn: 'warning',
  error: 'destructive',
};

interface TimelineEntry {
  ts: Date;
  kind: 'event' | 'api';
  data:
    | (typeof traceEvents.$inferSelect & { kind: 'event' })
    | (typeof mexApiCalls.$inferSelect & { kind: 'api' });
}

export default async function OperationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const op = await db.query.operations.findFirst({ where: eq(operations.id, id) });
  if (!op) notFound();

  const events = await db
    .select()
    .from(traceEvents)
    .where(eq(traceEvents.operationId, id))
    .orderBy(asc(traceEvents.ts));

  const calls = await db
    .select()
    .from(mexApiCalls)
    .where(eq(mexApiCalls.operationId, id))
    .orderBy(asc(mexApiCalls.ts));

  const timeline: TimelineEntry[] = [
    ...events.map((e) => ({ ts: e.ts, kind: 'event' as const, data: { ...e, kind: 'event' as const } })),
    ...calls.map((c) => ({ ts: c.ts, kind: 'api' as const, data: { ...c, kind: 'api' as const } })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Operacion</h1>
        <Badge variant={STATUS_VARIANT[op.status] ?? 'secondary'}>{op.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resumen</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <Row label="ID" value={op.id} mono />
          <Row label="Tipo" value={op.type} />
          <Row label="Usuario" value={op.userId ?? '-'} mono />
          <Row label="Entidad" value={`${op.entityType ?? '-'} ${op.entityId ?? ''}`} mono />
          <Row label="Inicio" value={formatDate(op.startedAt)} />
          <Row label="Fin" value={op.finishedAt ? formatDate(op.finishedAt) : '-'} />
          <Row label="Duracion" value={op.durationMs ? `${op.durationMs}ms` : '-'} />
          <Row label="Resumen" value={op.summary ?? '-'} />
          {op.failedReason ? (
            <div className="p-2 mt-2 rounded bg-destructive/10 border border-destructive/40 text-destructive text-sm">
              <strong>Fallo en {op.failedAtStep ?? '-'}:</strong> {op.failedReason}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay eventos</p>
          ) : (
            <ol className="space-y-3 border-l pl-4">
              {timeline.map((entry, idx) => (
                <li key={`${entry.kind}-${idx}`} className="relative">
                  <span className="absolute -left-[18px] top-2 h-2 w-2 rounded-full bg-muted-foreground" />
                  <div className="text-xs text-muted-foreground">
                    {formatDate(entry.ts)} ({entry.ts.toISOString().slice(11, 23)})
                  </div>
                  {entry.data.kind === 'event' ? (
                    <EventBlock event={entry.data} />
                  ) : (
                    <ApiCallBlock call={entry.data} />
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="w-32 text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono break-all' : ''}>{value}</span>
    </div>
  );
}

function EventBlock({ event }: { event: typeof traceEvents.$inferSelect }) {
  const isError = event.level === 'error';
  return (
    <div
      className={`rounded-md border p-2 text-sm ${isError ? 'bg-destructive/10 border-destructive/40' : 'bg-card'}`}
    >
      <div className="flex items-center gap-2">
        <Badge variant={LEVEL_VARIANT[event.level] ?? 'secondary'}>{event.level}</Badge>
        <span className="font-mono text-xs">{event.step}</span>
      </div>
      <div className="mt-1">{event.message}</div>
      {event.payloadJson ? (
        <details className="mt-1">
          <summary className="text-xs cursor-pointer text-muted-foreground">payload</summary>
          <JsonViewer value={event.payloadJson} />
        </details>
      ) : null}
    </div>
  );
}

function ApiCallBlock({ call }: { call: typeof mexApiCalls.$inferSelect }) {
  const isError = (call.responseStatus ?? 0) >= 400 || call.error;
  return (
    <div
      className={`rounded-md border p-2 text-sm ${isError ? 'bg-destructive/10 border-destructive/40' : 'bg-card'}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={isError ? 'destructive' : 'secondary'}>{call.method}</Badge>
        <span className="font-mono text-xs">{call.endpoint}</span>
        {call.responseStatus ? (
          <Badge variant={isError ? 'destructive' : 'success'}>{call.responseStatus}</Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">{call.responseMs}ms</span>
        <CurlButton call={call} />
      </div>
      {call.error ? <div className="text-destructive text-xs mt-1">{call.error}</div> : null}
      <details className="mt-1">
        <summary className="text-xs cursor-pointer text-muted-foreground">request</summary>
        <JsonViewer value={call.requestParams} />
      </details>
      <details className="mt-1">
        <summary className="text-xs cursor-pointer text-muted-foreground">response</summary>
        <JsonViewer value={call.responseBody} />
      </details>
    </div>
  );
}
