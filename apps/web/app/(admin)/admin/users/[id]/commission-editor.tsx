'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ASSETS } from '@rb/domain';
import { saveUserCommissionAction, fetchUserCommissionsAction } from './commission-server';

interface Row {
  asset: string;
  percent: string;
  fixedAmount: string;
}

export function CommissionEditor({ userId }: { userId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchUserCommissionsAction(userId).then(setRows);
  }, [userId]);

  const updateRow = (asset: string, patch: Partial<Row>) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.asset === asset);
      if (idx === -1) return [...prev, { asset, percent: '0', fixedAmount: '0', ...patch }];
      const copy = [...prev];
      copy[idx] = { ...copy[idx]!, ...patch };
      return copy;
    });
  };

  const save = (asset: string) => {
    const r = rows.find((x) => x.asset === asset) ?? { asset, percent: '0', fixedAmount: '0' };
    start(async () => {
      setErr(null);
      const res = await saveUserCommissionAction(userId, r);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  };

  const allAssets = ['*', ...ASSETS] as const;

  return (
    <div className="space-y-3 text-sm">
      {err ? <p className="text-destructive">{err}</p> : null}
      {allAssets.map((a) => {
        const r = rows.find((x) => x.asset === a) ?? { asset: a, percent: '0', fixedAmount: '0' };
        return (
          <div key={a} className="grid grid-cols-[80px_1fr_1fr_auto] items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">{a === '*' ? 'Default' : a}</Label>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`p-${a}`}>%</Label>
              <Input
                id={`p-${a}`}
                value={r.percent}
                onChange={(e) => updateRow(a, { percent: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`f-${a}`}>Fijo</Label>
              <Input
                id={`f-${a}`}
                value={r.fixedAmount}
                onChange={(e) => updateRow(a, { fixedAmount: e.target.value })}
              />
            </div>
            <Button size="sm" onClick={() => save(a)} disabled={isPending}>
              Guardar
            </Button>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Porcentaje en formato decimal (0.015 = 1.5%). El usuario ve esto como su comision.
      </p>
    </div>
  );
}
