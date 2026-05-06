'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber } from '@/lib/utils';

interface PriceItem {
  asset: string;
  symbol: string;
  compra: number;
  venta: number;
}

interface PricesResponse {
  ts: string;
  items: PriceItem[];
}

const REFRESH_MS = 60_000;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function priceDecimals(asset: string): number {
  // BTC moves in 1-USDT-or-better steps, ETH in cents. Other assets default
  // to 4 decimals to keep the columns readable.
  if (asset === 'BTC') return 2;
  if (asset === 'ETH') return 2;
  return 4;
}

export function PricesCard() {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/user/prices', {
        cache: 'no-store',
        signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as PricesResponse;
      setData(json);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const id = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      clearInterval(id);
      controller.abort();
    };
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle>Precios</CardTitle>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {data ? (
              <>
                <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_1px_rgb(16_185_129_/_0.6)] animate-pulse" />
                Actualizado {formatTime(data.ts)} - auto cada 60s
              </>
            ) : (
              'Cargando precios...'
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void load();
          }}
          disabled={loading}
        >
          {loading ? 'Actualizando...' : 'Refrescar'}
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">
            No se pudieron obtener los precios ({error}).
          </p>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin datos disponibles por ahora.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Activo</TableHead>
                <TableHead className="text-right">Compra (USDT)</TableHead>
                <TableHead className="text-right">Venta (USDT)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.symbol}>
                  <TableCell className="font-medium">{item.asset}</TableCell>
                  <TableCell className="text-right">
                    {formatNumber(item.compra, priceDecimals(item.asset))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(item.venta, priceDecimals(item.asset))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
