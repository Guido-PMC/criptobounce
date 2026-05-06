'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { approveUserAction, rejectUserAction } from './actions';

export function ApproveForm({ userId, alreadyHasMex }: { userId: string; alreadyHasMex: boolean }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ipChecked, setIpChecked] = useState(false);

  return (
    <form
      className="space-y-4"
      action={(formData) => {
        setErr(null);
        formData.set('ipWhitelisted', ipChecked ? 'yes' : 'no');
        start(async () => {
          const res = await approveUserAction(userId, formData);
          if (!res.ok) setErr(res.error);
          else router.push('/admin/users');
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="mexEmail">Email de la cuenta de exchange</Label>
        <Input id="mexEmail" name="mexEmail" type="email" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API key</Label>
        <Textarea id="apiKey" name="apiKey" required rows={2} className="font-mono text-xs" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiSecret">API secret</Label>
        <Textarea id="apiSecret" name="apiSecret" required rows={2} className="font-mono text-xs" />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={ipChecked} onCheckedChange={(v) => setIpChecked(Boolean(v))} />
        Confirmo que ya whitelisteé la IP del worker en el exchange
      </label>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      {alreadyHasMex ? (
        <p className="text-sm text-yellow-600">
          Este usuario ya tiene una cuenta vinculada. Si continuas se reemplaza.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Procesando...' : 'Aprobar y enviar invitacion'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            if (!confirm('Rechazar al usuario? Se marca como suspended.')) return;
            start(async () => {
              const res = await rejectUserAction(userId);
              if (!res.ok) setErr(res.error);
              else router.push('/admin/users/pending');
            });
          }}
        >
          Rechazar
        </Button>
      </div>
    </form>
  );
}
