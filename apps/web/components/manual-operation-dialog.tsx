'use client';

import {
  type ManualActionState,
  createManualOperationAction,
} from '@/app/(admin)/admin/manual-operations/actions';
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
import type { MexOutputAsset, MexOutputNetwork } from '@rb/mex-client';
import Link from 'next/link';
import { useActionState, useEffect, useMemo, useState } from 'react';

export interface ManualOperationWalletOption {
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
  successHref,
  triggerLabel = 'Operación manual',
}: {
  userId: string;
  wallets: ManualOperationWalletOption[];
  disabled?: boolean;
  successHref?: string;
  triggerLabel?: string;
}) {
  const [fromAsset, setFromAsset] = useState('USDT');
  const fromNetworks = SUPPORTED_PAIRS.filter((pair) => pair.asset === fromAsset);
  const [fromNetwork, setFromNetwork] = useState(fromNetworks[0]?.network ?? '');
  const [outputAssets, setOutputAssets] = useState<MexOutputAsset[]>([]);
  const [toAsset, setToAsset] = useState('');
  const [payoutNetwork, setPayoutNetwork] = useState<MexOutputNetwork | null>(null);
  const [payoutAddress, setPayoutAddress] = useState('');
  const [payoutMemo, setPayoutMemo] = useState('');
  const [payoutConfirmed, setPayoutConfirmed] = useState(false);
  const [catalogError, setCatalogError] = useState<string>();
  const [catalogLoading, setCatalogLoading] = useState(true);
  const refundWallets = useMemo(
    () => wallets.filter((wallet) => wallet.asset === fromAsset && wallet.network === fromNetwork),
    [wallets, fromAsset, fromNetwork],
  );
  const selectedOutput = outputAssets.find((output) => output.asset === toAsset);
  const action = createManualOperationAction.bind(null, userId);
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    const abort = new AbortController();
    setCatalogLoading(true);
    setCatalogError(undefined);
    setOutputAssets([]);
    setToAsset('');
    setPayoutNetwork(null);
    setPayoutAddress('');
    setPayoutMemo('');
    setPayoutConfirmed(false);
    const params = new URLSearchParams({ userId, fromAsset });
    fetch(`/api/admin/manual-operations/catalog?${params}`, {
      signal: abort.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as { assets?: MexOutputAsset[]; error?: string };
        if (!response.ok || !payload.assets) {
          throw new Error(payload.error ?? 'No se pudo cargar el catálogo MEX');
        }
        setOutputAssets(payload.assets);
        const initial =
          payload.assets.find((output) => output.asset === 'BTC') ?? payload.assets[0] ?? null;
        setToAsset(initial?.asset ?? '');
        setPayoutNetwork(initial?.networks[0] ?? null);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setCatalogError(error instanceof Error ? error.message : 'No se pudo cargar el catálogo');
      })
      .finally(() => {
        if (!abort.signal.aborted) setCatalogLoading(false);
      });
    return () => abort.abort();
  }, [fromAsset, userId]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={disabled}>{triggerLabel}</Button>
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
              href={
                successHref
                  ? `${successHref}?created=${state.operationId}`
                  : `/admin/manual-operations/${state.operationId}`
              }
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
                  setFromNetwork(
                    SUPPORTED_PAIRS.find((pair) => pair.asset === asset)?.network ?? '',
                  );
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
                  setPayoutNetwork(
                    outputAssets.find((output) => output.asset === asset)?.networks[0] ?? null,
                  );
                  setPayoutAddress('');
                  setPayoutMemo('');
                  setPayoutConfirmed(false);
                }}
                disabled={catalogLoading || outputAssets.length === 0}
                required
              >
                {catalogLoading ? <option value="">Cargando catálogo MEX…</option> : null}
                {!catalogLoading && outputAssets.length === 0 ? (
                  <option value="">Sin activos disponibles</option>
                ) : null}
                {outputAssets.map((output) => (
                  <option key={output.asset} value={output.asset}>
                    {output.asset} · {output.name}
                  </option>
                ))}
              </select>
              {catalogError ? <p className="text-xs text-destructive">{catalogError}</p> : null}
            </Field>
            <Field label="Red salida">
              <select
                className={selectClass}
                value={
                  payoutNetwork
                    ? JSON.stringify([payoutNetwork.mexCoin, payoutNetwork.mexNetwork])
                    : ''
                }
                onChange={(event) => {
                  const [mexCoin, mexNetwork] = JSON.parse(event.target.value) as [string, string];
                  setPayoutNetwork(
                    selectedOutput?.networks.find(
                      (network) => network.mexCoin === mexCoin && network.mexNetwork === mexNetwork,
                    ) ?? null,
                  );
                  setPayoutAddress('');
                  setPayoutMemo('');
                  setPayoutConfirmed(false);
                }}
                disabled={!selectedOutput}
                required
              >
                {(selectedOutput?.networks ?? []).map((network) => (
                  <option
                    key={`${network.mexCoin}:${network.mexNetwork}`}
                    value={JSON.stringify([network.mexCoin, network.mexNetwork])}
                  >
                    {network.mexNetwork} · fee {network.withdrawFee} · mínimo {network.withdrawMin}
                    {network.memoRequired ? ' · requiere memo/tag' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <input type="hidden" name="toNetwork" value={payoutNetwork?.mexNetwork ?? ''} />
            <input type="hidden" name="payoutMexCoin" value={payoutNetwork?.mexCoin ?? ''} />
            <input type="hidden" name="payoutMexNetwork" value={payoutNetwork?.mexNetwork ?? ''} />
            <Field label="Dirección payout">
              <Input
                name="payoutAddress"
                autoComplete="off"
                minLength={8}
                maxLength={200}
                value={payoutAddress}
                onChange={(event) => {
                  setPayoutAddress(event.target.value);
                  setPayoutConfirmed(false);
                }}
                required
              />
              <p className="text-xs text-muted-foreground">
                Verificá que corresponda exactamente a la red seleccionada.
              </p>
            </Field>
            <Field label="Memo/tag payout (opcional)">
              <Input
                name="payoutMemo"
                autoComplete="off"
                maxLength={200}
                value={payoutMemo}
                onChange={(event) => {
                  setPayoutMemo(event.target.value);
                  setPayoutConfirmed(false);
                }}
                required={payoutNetwork?.memoRequired}
              />
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
              <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/60 p-3 text-sm">
                <input
                  className="mt-0.5 h-4 w-4"
                  type="checkbox"
                  name="payoutConfirmed"
                  checked={payoutConfirmed}
                  onChange={(event) => setPayoutConfirmed(event.target.checked)}
                  required
                />
                <span>
                  Confirmo que la dirección, la red y el memo/tag corresponden al destino y fueron
                  verificados antes de crear la operación.
                </span>
              </label>
            </div>
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
              disabled={pending || catalogLoading || !payoutNetwork || !toAsset}
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
