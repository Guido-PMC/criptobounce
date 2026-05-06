'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
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
import { ASSETS, NETWORKS } from '@rb/domain';
import { saveRuleAction, deleteRuleAction } from './actions';

interface WalletOption {
  id: string;
  label: string;
  asset: string;
  network: string;
}
interface RuleDTO {
  id: string;
  fromAsset: string | null;
  fromNetwork: string | null;
  toAsset: string;
  toNetwork: string;
  destinationWalletId: string;
  priority: number;
  enabled: boolean;
}

const ANY = '*';

export function RuleEditor({ wallets, rule }: { wallets: WalletOption[]; rule?: RuleDTO }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [fromAsset, setFromAsset] = useState(rule?.fromAsset ?? ANY);
  const [fromNetwork, setFromNetwork] = useState(rule?.fromNetwork ?? ANY);
  const [walletId, setWalletId] = useState(rule?.destinationWalletId ?? wallets[0]?.id ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const selectedWallet = wallets.find((w) => w.id === walletId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={rule ? 'outline' : 'default'}>
          {rule ? 'Editar' : 'Nueva regla'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? 'Editar regla' : 'Nueva regla'}</DialogTitle>
        </DialogHeader>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Necesitas al menos una wallet de destino antes de crear reglas.
          </p>
        ) : (
          <form
            className="space-y-4"
            action={(formData) => {
              setErr(null);
              formData.set('fromAsset', fromAsset);
              formData.set('fromNetwork', fromNetwork);
              formData.set('destinationWalletId', walletId);
              formData.set('enabled', enabled ? '1' : '0');
              if (rule) formData.set('id', rule.id);
              start(async () => {
                const res = await saveRuleAction(formData);
                if (!res.ok) setErr(res.error);
                else {
                  setOpen(false);
                  router.refresh();
                }
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Si recibo asset</Label>
                <Select value={fromAsset} onValueChange={setFromAsset}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Cualquiera</SelectItem>
                    {ASSETS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>en red</Label>
                <Select value={fromNetwork} onValueChange={setFromNetwork}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Cualquiera</SelectItem>
                    {NETWORKS.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Convertir y enviar a wallet</Label>
              <Select value={walletId} onValueChange={setWalletId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegi wallet" />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.label} ({w.asset}/{w.network})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWallet ? (
                <p className="text-xs text-muted-foreground">
                  El destino sera {selectedWallet.asset} en {selectedWallet.network}.
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="priority">Prioridad (menor = mas especifico)</Label>
              <Input
                id="priority"
                name="priority"
                type="number"
                defaultValue={rule?.priority ?? 100}
                min={1}
                max={1000}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
              Regla activa
            </label>

            {err ? <p className="text-sm text-destructive">{err}</p> : null}

            <div className="flex justify-between pt-2">
              {rule ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => {
                    if (!confirm('Eliminar regla?')) return;
                    start(async () => {
                      const res = await deleteRuleAction(rule.id);
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
                Guardar
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
