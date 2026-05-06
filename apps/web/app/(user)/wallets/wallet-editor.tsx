'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ASSETS, NETWORKS, SUPPORTED_PAIRS } from '@rb/domain';
import { saveWalletAction, deleteWalletAction } from './actions';

export interface WalletDTO {
  id: string;
  label: string;
  asset: string;
  network: string;
  address: string;
  memo: string | null;
  isDefault: boolean;
}

export function WalletEditor({ wallet }: { wallet?: WalletDTO } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [asset, setAsset] = useState(wallet?.asset ?? 'USDT');
  const [network, setNetwork] = useState(wallet?.network ?? 'TRC20');
  const [isDefault, setIsDefault] = useState(wallet?.isDefault ?? false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={wallet ? 'outline' : 'default'}>
          {wallet ? 'Editar' : 'Agregar wallet'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{wallet ? 'Editar wallet' : 'Nueva wallet de destino'}</DialogTitle>
          <DialogDescription>
            Las direcciones se validan segun la red. Asegurate de que sea correcta.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          action={(formData) => {
            setErr(null);
            formData.set('asset', asset);
            formData.set('network', network);
            formData.set('isDefault', isDefault ? '1' : '0');
            if (wallet) formData.set('id', wallet.id);
            start(async () => {
              const res = await saveWalletAction(formData);
              if (!res.ok) setErr(res.error);
              else {
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="label">Alias</Label>
            <Input id="label" name="label" defaultValue={wallet?.label} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Asset</Label>
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSETS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Red</Label>
              <Select value={network} onValueChange={setNetwork}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NETWORKS.filter((n) =>
                    SUPPORTED_PAIRS.some((p) => p.asset === asset && p.network === n),
                  ).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Direccion</Label>
            <Input
              id="address"
              name="address"
              defaultValue={wallet?.address}
              className="font-mono text-xs"
              required
            />
          </div>

          {network === 'TRC20' ? (
            <div className="space-y-2">
              <Label htmlFor="memo">Memo (opcional)</Label>
              <Input id="memo" name="memo" defaultValue={wallet?.memo ?? ''} />
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isDefault}
              onCheckedChange={(v) => setIsDefault(Boolean(v))}
            />
            Marcar como default para {asset}/{network}
          </label>

          {err ? <p className="text-sm text-destructive">{err}</p> : null}

          <div className="flex justify-between pt-2">
            {wallet ? (
              <Button
                type="button"
                variant="destructive"
                disabled={isPending}
                onClick={() => {
                  if (!confirm('Eliminar esta wallet?')) return;
                  start(async () => {
                    const res = await deleteWalletAction(wallet.id);
                    if (!res.ok) setErr(res.error);
                    else {
                      setOpen(false);
                      router.refresh();
                    }
                  });
                }}
              >
                Eliminar
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
