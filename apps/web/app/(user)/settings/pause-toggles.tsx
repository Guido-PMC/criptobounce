'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ASSETS } from '@rb/domain';
import { setPauseAction } from './actions';

export function PauseToggles({
  globalPaused,
  pausedAssets,
}: { globalPaused: boolean; pausedAssets: string[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [global, setGlobal] = useState(globalPaused);
  const [paused, setPaused] = useState<string[]>(pausedAssets);

  const togglePause = (next: boolean) => {
    setGlobal(next);
    start(async () => {
      await setPauseAction({ global: next, assets: paused });
      router.refresh();
    });
  };
  const toggleAsset = (a: string) => {
    const next = paused.includes(a) ? paused.filter((x) => x !== a) : [...paused, a];
    setPaused(next);
    start(async () => {
      await setPauseAction({ global, assets: next });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>Pausa global</Label>
          <p className="text-xs text-muted-foreground">
            Cuando esta activa, no se reenvian fondos en ningun activo.
          </p>
        </div>
        <Switch checked={global} onCheckedChange={togglePause} disabled={isPending} />
      </div>
      <div className="space-y-2">
        <Label>Pausa por activo</Label>
        <div className="flex gap-3 flex-wrap">
          {ASSETS.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm border rounded px-3 py-1">
              <Switch
                checked={paused.includes(a)}
                onCheckedChange={() => toggleAsset(a)}
                disabled={isPending}
              />
              <span>{a}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
