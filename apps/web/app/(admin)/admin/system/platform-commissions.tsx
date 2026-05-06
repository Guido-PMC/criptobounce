'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ASSETS } from '@rb/domain';
import { savePlatformCommissionAction } from './actions';

interface Row {
  asset: string;
  percent: string;
  fixedAmount: string;
}

export function PlatformCommissionsEditor({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial);
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const get = (asset: string): Row =>
    rows.find((r) => r.asset === asset) ?? { asset, percent: '0', fixedAmount: '0' };

  const update = (asset: string, patch: Partial<Row>) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.asset === asset);
      if (idx === -1) return [...prev, { asset, percent: '0', fixedAmount: '0', ...patch }];
      const copy = [...prev];
      copy[idx] = { ...copy[idx]!, ...patch };
      return copy;
    });
  };

  const save = (asset: string) => {
    start(async () => {
      setErr(null);
      const r = get(asset);
      const res = await savePlatformCommissionAction(r);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  };

  const allAssets = ['*', ...ASSETS] as const;

  return (
    <div className="space-y-3 text-sm">
      {err ? <p className="text-destructive">{err}</p> : null}
      {allAssets.map((a) => {
        const r = get(a);
        return (
          <div key={a} className="grid grid-cols-[80px_1fr_1fr_auto] items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">{a === '*' ? 'Default' : a}</Label>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pp-${a}`}>%</Label>
              <Input
                id={`pp-${a}`}
                value={r.percent}
                onChange={(e) => update(a, { percent: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pf-${a}`}>Fijo</Label>
              <Input
                id={`pf-${a}`}
                value={r.fixedAmount}
                onChange={(e) => update(a, { fixedAmount: e.target.value })}
              />
            </div>
            <Button size="sm" onClick={() => save(a)} disabled={isPending}>
              Guardar
            </Button>
          </div>
        );
      })}
    </div>
  );
}
