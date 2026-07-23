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

interface ManualQuotePreview {
  verifierDigits: string;
  exactDepositAmount: string;
  nominalAmount: string;
  estimatedOutput: string;
  price: string;
  symbol: string | null;
  side: 'BUY' | 'SELL' | null;
  withdrawFee: string;
  userCommission: { percent: number; fixed: number };
  platformCommission: { percent: number; fixed: number };
  quotedAt: string;
}

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
  const [amountMode, setAmountMode] = useState<'input' | 'output'>('input');
  const [inputAmount, setInputAmount] = useState('100');
  const [outputAmount, setOutputAmount] = useState('');
  const [quote, setQuote] = useState<ManualQuotePreview | null>(null);
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [catalogError, setCatalogError] = useState<string>();
  const [catalogLoading, setCatalogLoading] = useState(true);
  const refundWallets = useMemo(
    () => wallets.filter((wallet) => wallet.asset === fromAsset && wallet.network === fromNetwork),
    [wallets, fromAsset, fromNetwork],
  );
  const selectedOutput = outputAssets.find((output) => output.asset === toAsset);
  const action = createManualOperationAction.bind(null, userId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const activeAmount = amountMode === 'input' ? inputAmount : outputAmount;
  const verifierDigits = quote?.verifierDigits ?? '';

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
    setQuote(null);
    setQuoteError(undefined);
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

  useEffect(() => {
    if (!toAsset || !payoutNetwork || !activeAmount || !/^\d+(?:\.\d+)?$/.test(activeAmount)) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    const abort = new AbortController();
    const immediateRefresh = Date.now() - quoteRefresh < 1_000;
    const timer = window.setTimeout(
      () => {
        setQuoteLoading(true);
        setQuoteError(undefined);
        const params = new URLSearchParams({
          userId,
          fromAsset,
          fromNetwork,
          toAsset,
          amount: activeAmount,
          mode: amountMode,
          withdrawFee: payoutNetwork.withdrawFee,
        });
        if (verifierDigits) params.set('verifierDigits', verifierDigits);
        fetch(`/api/admin/manual-operations/quote?${params}`, {
          signal: abort.signal,
          cache: 'no-store',
        })
          .then(async (response) => {
            const payload = (await response.json()) as ManualQuotePreview & { error?: string };
            if (!response.ok || !payload.nominalAmount) {
              throw new Error(payload.error ?? 'No se pudo obtener la cotización');
            }
            setQuote(payload);
            setInputAmount(payload.nominalAmount);
            if (amountMode === 'input') setOutputAmount(payload.estimatedOutput);
          })
          .catch((error: unknown) => {
            if (abort.signal.aborted) return;
            setQuote(null);
            setQuoteError(
              error instanceof Error ? error.message : 'No se pudo obtener la cotización',
            );
          })
          .finally(() => {
            if (!abort.signal.aborted) setQuoteLoading(false);
          });
      },
      immediateRefresh ? 0 : 500,
    );
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [
    activeAmount,
    amountMode,
    fromAsset,
    fromNetwork,
    payoutNetwork,
    quoteRefresh,
    toAsset,
    userId,
    verifierDigits,
  ]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={disabled}>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear operación manual</DialogTitle>
          <DialogDescription>
            Ingresá cuánto querés gastar o recibir. La cotización y el monto identificador se
            calculan antes de crear la operación.
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
                  setAmountMode('input');
                  setInputAmount('100');
                  setOutputAmount('');
                  setQuote(null);
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
                onChange={(event) => {
                  setFromNetwork(event.target.value);
                  setQuote(null);
                }}
              >
                {fromNetworks.map((pair) => (
                  <option key={pair.network}>{pair.network}</option>
                ))}
              </select>
            </Field>
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
                  setAmountMode('input');
                  setOutputAmount('');
                  setQuote(null);
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
                  setQuote(null);
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
            <Field label={`Quiero gastar (${fromAsset})`}>
              <Input
                inputMode="decimal"
                placeholder="100"
                value={inputAmount}
                onChange={(event) => {
                  setAmountMode('input');
                  setInputAmount(event.target.value);
                  setQuote(null);
                  setQuoteError(undefined);
                }}
                required
              />
            </Field>
            <Field label={`Quiero recibir (${toAsset || 'salida'})`}>
              <Input
                inputMode="decimal"
                placeholder="0"
                value={outputAmount}
                onChange={(event) => {
                  setAmountMode('output');
                  setOutputAmount(event.target.value);
                  setQuote(null);
                  setQuoteError(undefined);
                }}
                disabled={!toAsset}
                required
              />
            </Field>
            <input type="hidden" name="nominalAmount" value={quote?.nominalAmount ?? ''} />
            <input type="hidden" name="amountMode" value={amountMode} />
            <input type="hidden" name="requestedAmount" value={activeAmount} />
            <input type="hidden" name="verifierDigits" value={verifierDigits} />
            <div className="space-y-3 rounded-md border bg-muted/30 p-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Cotización MEX</p>
                  <p className="text-xs text-muted-foreground">
                    {quote
                      ? `Actualizada ${new Date(quote.quotedAt).toLocaleTimeString('es-AR')}`
                      : 'Ingresá un monto para cotizar'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={quoteLoading || !activeAmount || !payoutNetwork}
                  onClick={() => setQuoteRefresh(Date.now())}
                >
                  {quoteLoading ? 'Actualizando…' : 'Actualizar cotización'}
                </Button>
              </div>
              {quote ? (
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <QuoteDatum
                    label="Precio"
                    value={
                      quote.side === 'BUY'
                        ? `1 ${toAsset} = ${quote.price} ${fromAsset}`
                        : quote.side === 'SELL'
                          ? `1 ${fromAsset} = ${quote.price} ${toAsset}`
                          : `1 ${fromAsset} = 1 ${toAsset}`
                    }
                  />
                  <QuoteDatum
                    label="Resultado neto estimado"
                    value={`${quote.estimatedOutput} ${toAsset}`}
                  />
                  <QuoteDatum label="Monto base" value={`${quote.nominalAmount} ${fromAsset}`} />
                  <QuoteDatum
                    label={`Identificador ${quote.verifierDigits}`}
                    value={`${quote.nominalAmount} + identificador = ${quote.exactDepositAmount} ${fromAsset}`}
                  />
                  <QuoteDatum label="Fee de retiro" value={`${quote.withdrawFee} ${toAsset}`} />
                  <QuoteDatum
                    label="Comisiones"
                    value={`${(
                      (quote.userCommission.percent + quote.platformCommission.percent) * 100
                    ).toFixed(2)}% + ${(
                      quote.userCommission.fixed + quote.platformCommission.fixed
                    ).toFixed(8)} ${toAsset}`}
                  />
                </div>
              ) : null}
              {quoteError ? <p className="text-xs text-destructive">{quoteError}</p> : null}
              <p className="text-xs text-muted-foreground">
                El monto de salida es estimado. Al crear, el servidor vuelve a cotizar y la
                ejecución final se realiza a mercado.
              </p>
            </div>
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
            {state.error ? (
              <p className="sm:col-span-2 text-sm text-destructive">{state.error}</p>
            ) : null}
            <Button
              className="sm:col-span-2"
              type="submit"
              disabled={
                pending || catalogLoading || quoteLoading || !quote || !payoutNetwork || !toAsset
              }
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

function QuoteDatum({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono">{value}</p>
    </div>
  );
}
