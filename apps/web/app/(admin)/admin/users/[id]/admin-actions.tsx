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
import { ASSETS, NETWORKS, SUPPORTED_PAIRS } from '@rb/domain';
import {
  suspendUserAction,
  reactivateUserAction,
  manualSweepAction,
  rotateApiKeysAction,
  reassignTelegramAction,
} from './admin-actions-server';

export function AdminUserActions({
  userId,
  status,
  hasMexAccount,
}: { userId: string; status: string; hasMexAccount: boolean }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {err ? <p className="text-sm text-destructive">{err}</p> : null}

      {status === 'approved' ? (
        <Button
          variant="destructive"
          disabled={isPending}
          onClick={() => {
            if (!confirm('Suspender al usuario? Sus reenvios paran inmediatamente.')) return;
            start(async () => {
              setErr(null);
              const res = await suspendUserAction(userId);
              if (!res.ok) setErr(res.error);
              else router.refresh();
            });
          }}
        >
          Suspender
        </Button>
      ) : (
        <Button
          variant="default"
          disabled={isPending}
          onClick={() => {
            start(async () => {
              setErr(null);
              const res = await reactivateUserAction(userId);
              if (!res.ok) setErr(res.error);
              else router.refresh();
            });
          }}
        >
          Reactivar
        </Button>
      )}

      <RotateKeysButton userId={userId} disabled={!hasMexAccount} />
      <ManualSweepDialog userId={userId} disabled={!hasMexAccount} />
      <ReassignTelegramDialog userId={userId} />
    </div>
  );
}

function RotateKeysButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Rotar API keys
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotar API keys</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          action={(formData) => {
            setErr(null);
            start(async () => {
              const res = await rotateApiKeysAction(userId, formData);
              if (!res.ok) setErr(res.error);
              else {
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="apiKey">Nueva API key</Label>
            <Input id="apiKey" name="apiKey" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="apiSecret">Nuevo API secret</Label>
            <Input id="apiSecret" name="apiSecret" required />
          </div>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          <Button type="submit" disabled={isPending}>
            Rotar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManualSweepDialog({ userId, disabled }: { userId: string; disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [asset, setAsset] = useState<string>('USDT');
  const [network, setNetwork] = useState<string>('TRC20');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Barrer fondos a wallet externa
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Barrido manual de fondos</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          action={(formData) => {
            setErr(null);
            formData.set('asset', asset);
            formData.set('network', network);
            if (!confirm(`Confirmas el barrido de ${asset} en ${network}?`)) return;
            start(async () => {
              const res = await manualSweepAction(userId, formData);
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
            <div className="space-y-1">
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
          <div className="space-y-1">
            <Label htmlFor="address">Direccion destino</Label>
            <Input id="address" name="address" required className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amount">Monto</Label>
            <Input id="amount" name="amount" required inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="memo">Memo (opcional)</Label>
            <Input id="memo" name="memo" />
          </div>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          <Button type="submit" disabled={isPending}>
            Lanzar barrido
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReassignTelegramDialog({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Reasignar Telegram</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reasignar Telegram ID</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          action={(formData) => {
            setErr(null);
            if (!confirm('Verificaste la identidad fuera de banda? Confirma para continuar.')) return;
            start(async () => {
              const res = await reassignTelegramAction(userId, formData);
              if (!res.ok) setErr(res.error);
              else {
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="newTelegramId">Nuevo Telegram ID</Label>
            <Input id="newTelegramId" name="newTelegramId" inputMode="numeric" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newTelegramUsername">Nuevo username</Label>
            <Input id="newTelegramUsername" name="newTelegramUsername" />
          </div>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          <Button type="submit" disabled={isPending} variant="destructive">
            Reasignar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
