'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { setMaintenanceAction } from './actions';
import type { MaintenanceModeValue } from '@rb/db';

export function MaintenanceToggle({
  initial,
  inFlightCount,
}: { initial: MaintenanceModeValue; inFlightCount: number }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [reason, setReason] = useState(initial.reason ?? '');
  const [scheduleHours, setScheduleHours] = useState(0);
  const [confirmStep, setConfirmStep] = useState(0);
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [enabled, router]);

  const submit = (next: boolean) => {
    setErr(null);
    start(async () => {
      const res = await setMaintenanceAction({
        enabled: next,
        reason: next ? reason : undefined,
        scheduleHours: next && scheduleHours > 0 ? scheduleHours : undefined,
      });
      if (!res.ok) setErr(res.error);
      else {
        setEnabled(next);
        setConfirmStep(0);
        router.refresh();
      }
    });
  };

  if (initial.enabled) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm font-semibold">Sistema EN MANTENIMIENTO</p>
          {initial.reason ? <p className="text-sm">Motivo: {initial.reason}</p> : null}
          {initial.scheduledUntil ? (
            <p className="text-xs">Programado hasta: {initial.scheduledUntil}</p>
          ) : null}
          <p className="text-xs mt-2">Jobs en vuelo terminando: {inFlightCount}</p>
        </div>
        <Button
          variant="default"
          disabled={isPending}
          onClick={() => submit(false)}
        >
          Desactivar mantenimiento
        </Button>
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="reason">Motivo (visible para vos en logs)</Label>
        <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={scheduleHours > 0}
          onCheckedChange={(v) => setScheduleHours(v ? 1 : 0)}
        />
        Programar fin automatico
      </label>
      {scheduleHours > 0 ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            value={scheduleHours}
            onChange={(e) => setScheduleHours(Math.max(1, Number(e.target.value)))}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">horas</span>
        </div>
      ) : null}
      {confirmStep === 0 ? (
        <Button variant="destructive" onClick={() => setConfirmStep(1)}>
          Activar mantenimiento
        </Button>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-sm">Confirma de nuevo para activar:</p>
          <Button variant="destructive" disabled={isPending} onClick={() => submit(true)}>
            Confirmo, activar
          </Button>
          <Button variant="outline" onClick={() => setConfirmStep(0)}>
            Cancelar
          </Button>
        </div>
      )}
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
    </div>
  );
}
