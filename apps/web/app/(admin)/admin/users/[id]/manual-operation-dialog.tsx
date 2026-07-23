'use client';

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
import { Textarea } from '@/components/ui/textarea';
import { ASSETS, SUPPORTED_PAIRS } from '@rb/domain';
import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import {
  type ManualActionState,
  createManualOperationAction,
} from '../../manual-operations/actions';

interface WalletOption {
  id: string;
  label: string;
  asset: string;
  network: string;
  address: string;
}

const initialState: ManualActionState = { ok: false };
const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';

export function ManualOperationDialog({
  userId,
  wallets,
  disabled,
}: {
  userId: string;
  wallets: WalletOption[];
  disabled?: boolean;
}) {
  const [fromAsset, setFromAsset] = useState('USDT');
  const [toAsset, setToAsset] = useState('BTC');
  const fromNetworks = SUPPORTED_PAIRS.filter((p) => p.asset === fromAsset);
  const toNetworks = SUPPORTED_PAIRS.filter((p) => p.asset === toAsset);
  const [fromNetwork, setFromNetwork] = useState(fromNetworks[0]?.network ?? '');
  const [toNetwork, setToNetwork] = useState(toNetworks[0]?.network ?? '');
  const payoutWallets = useMemo(
    () => wallets.filter((wallet) => wallet.asset === toAsset && wallet.network === toNetwork),
    [wallets, toAsset, toNetwork],
  );
  const refundWallets = useMemo(
    () => wallets.filter((wallet) => wallet.asset === fromAsset && wallet.network === fromNetwork),
    [wallets, fromAsset, fromNetwork],
  );
  const action = createManualOperationAction.bind(null, userId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={disabled}>Operación manual</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear operación manual</DialogTitle>
          <DialogDescription>
            El monto exacto y el estimado se calculan al confirmar. La operación vence en 15
            minutos.
          </DialogDescription>
        </DialogHeader>
        {state.ok && state.operationId ? (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
            Operación creada.{' '}
            <Link
              className="font-medium underline"
              href={`/admin/manual-operations/${state.operationId}`}
            >
              Ver monto exacto e instrucciones
            </Link>
          </div>
        ) : (
          <form action={formAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Activo entrada">
              <select
                className={selectClass}
                name="fromAsset"
                value={fromAsset}
                onChange={(event) => {
                  const asset = event.target.value;
                  setFromAsset(asset);
                  setFromNetwork(SUPPORTED_PAIRS.find((p) => p.asset === asset)?.network ?? '');
                }}
              >
                {ASSETS.map((asset) => (
                  <option key={asset}>{asset}</option>
                ))}
              </select>
            </Field>
            <Field label="Red entrada">
              <select
                className={selectClass}
                name="fromNetwork"
                value={fromNetwork}
                onChange={(event) => setFromNetwork(event.target.value)}
              >
                {fromNetworks.map((pair) => (
                  <option key={pair.network}>{pair.network}</option>
                ))}
              </select>
            </Field>
            <Field label="Monto nominal">
              <Input name="nominalAmount" inputMode="decimal" placeholder="100" required />
            </Field>
            <div />
            <Field label="Activo salida">
              <select
                className={selectClass}
                name="toAsset"
                value={toAsset}
                onChange={(event) => {
                  const asset = event.target.value;
                  setToAsset(asset);
                  setToNetwork(SUPPORTED_PAIRS.find((p) => p.asset === asset)?.network ?? '');
                }}
              >
                {ASSETS.map((asset) => (
                  <option key={asset}>{asset}</option>
                ))}
              </select>
            </Field>
            <Field label="Red salida">
              <select
                className={selectClass}
                name="toNetwork"
                value={toNetwork}
                onChange={(event) => setToNetwork(event.target.value)}
              >
                {toNetworks.map((pair) => (
                  <option key={pair.network}>{pair.network}</option>
                ))}
              </select>
            </Field>
            <Field label="Wallet payout">
              <select className={selectClass} name="payoutWalletId" required defaultValue="">
                <option value="" disabled>
                  Seleccionar…
                </option>
                {payoutWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.label} · {wallet.address}
                  </option>
                ))}
              </select>
              {!payoutWallets.length ? (
                <p className="text-xs text-destructive">No hay wallet compatible.</p>
              ) : null}
            </Field>
            <Field label="Wallet devolución (opcional)">
              <select className={selectClass} name="refundWalletId" defaultValue="">
                <option value="">Dejar fondos en MEX</option>
                {refundWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.label} · {wallet.address}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notas internas">
                <Textarea name="internalNotes" maxLength={2000} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Código TOTP">
                <Input
                  name="totpCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </Field>
            </div>
            {state.error ? (
              <p className="sm:col-span-2 text-sm text-destructive">{state.error}</p>
            ) : null}
            <Button
              className="sm:col-span-2"
              type="submit"
              disabled={pending || payoutWallets.length === 0}
            >
              {pending ? 'Validando…' : 'Crear operación'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
