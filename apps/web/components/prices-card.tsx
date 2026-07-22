'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyCommissionToQuote } from '@rb/domain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
  adminPreview?: boolean;
}

const REFRESH_MS = 60_000;
const ADMIN_MARKUP_MAX_PCT = 20;
const ADMIN_MARKUP_STEP_PCT = 0.1;
const ZERO_COMMISSION = { percent: 0, fixed: 0 };

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

interface PricesCardProps {
  isAdmin?: boolean;
}

export function PricesCard({ isAdmin = false }: PricesCardProps) {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markupPct, setMarkupPct] = useState(0);

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

  const displayItems = useMemo(() => {
    if (!data) return [];
    if (!isAdmin || markupPct <= 0) return data.items;
    const fraction = markupPct / 100;
    return data.items.map((item) => {
      const { compra, venta } = applyCommissionToQuote(
        { bid: item.venta, ask: item.compra },
        { percent: fraction, fixed: 0 },
        ZERO_COMMISSION,
      );
      return { ...item, compra, venta };
    });
  }, [data, isAdmin, markupPct]);

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
                {isAdmin ? ' · precio MEX sin markup' : ''}
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
      <CardContent className="space-y-4">
        {isAdmin ? (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>Simular markup</Label>
                <p className="text-xs text-muted-foreground">
                  Arrastrá para ver cómo quedarían los precios con comisión
                  aplicada. No se guarda ni afecta a otros usuarios.
                </p>
              </div>
              <div className="text-xl font-semibold tabular-nums shrink-0">
                {markupPct.toFixed(1)}%
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={ADMIN_MARKUP_MAX_PCT}
              step={ADMIN_MARKUP_STEP_PCT}
              value={markupPct}
              onChange={(e) => {
                setMarkupPct(Number(e.target.value));
              }}
              className="w-full accent-primary"
              aria-label="Simular markup"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0%</span>
              <span>{ADMIN_MARKUP_MAX_PCT}%</span>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive">
            No se pudieron obtener los precios ({error}).
          </p>
        ) : !data || displayItems.length === 0 ? (
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
              {displayItems.map((item) => (
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
