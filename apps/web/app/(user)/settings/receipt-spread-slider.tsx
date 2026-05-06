'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { setReceiptSpreadAction } from './actions';

const STEP_PCT = 0.05; // slider step in %
const MAX_PCT = 5; // slider max in %
const DEBOUNCE_MS = 350;

interface Props {
  initialFraction: number; // value as fraction (0..0.05)
}

export function ReceiptSpreadSlider({ initialFraction }: Props) {
  const startPct = Math.min(MAX_PCT, Math.max(0, initialFraction * 100));
  const [pct, setPct] = useState<number>(Number(startPct.toFixed(2)));
  const [savedPct, setSavedPct] = useState<number>(Number(startPct.toFixed(2)));
  const [isPending, start] = useTransition();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const persist = (nextPct: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      start(async () => {
        const res = await setReceiptSpreadAction({ percent: nextPct / 100 });
        if (res.ok) {
          setSavedPct(Number((res.percent * 100).toFixed(2)));
          router.refresh();
        }
      });
    }, DEBOUNCE_MS);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value);
    setPct(next);
    persist(next);
  };

  const dirty = Math.abs(pct - savedPct) > 1e-6;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label>Spread oculto en comprobantes</Label>
          <p className="text-xs text-muted-foreground max-w-md">
            Se aplica solo al tipo de cambio que aparece en el comprobante de
            cada operacion (no afecta los montos reales en blockchain ni la
            comision visible). El comprobante de operaciones ya finalizadas no
            cambia: usa el valor que estaba al cerrarse la operacion.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums">
            {pct.toFixed(2)}%
          </div>
          <div className="text-[10px] text-muted-foreground">
            {isPending
              ? 'guardando...'
              : dirty
                ? 'pendiente'
                : `guardado ${savedPct.toFixed(2)}%`}
          </div>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={MAX_PCT}
        step={STEP_PCT}
        value={pct}
        onChange={onChange}
        className="w-full accent-primary"
        disabled={isPending}
        aria-label="Spread oculto"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0%</span>
        <span>{MAX_PCT.toFixed(0)}%</span>
      </div>
    </div>
  );
}
