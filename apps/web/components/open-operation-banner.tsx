'use client';

import type { ActiveManualOperationPayload } from '@/lib/user-manual-operations';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const PROCESSING_MESSAGES: Record<string, string> = {
  converting: 'Preparando la conversión',
  awaiting_conversion: 'Esperando la confirmación de la conversión',
  withdrawing: 'Preparando el retiro a tu wallet',
  awaiting_withdrawal: 'Esperando la confirmación del retiro',
  refunding: 'Preparando la devolución del excedente',
  awaiting_refund: 'Esperando la confirmación de la devolución',
};

export function OpenOperationBanner({
  initialOperation,
}: {
  initialOperation: ActiveManualOperationPayload | null;
}) {
  const router = useRouter();
  const [operation, setOperation] = useState(initialOperation);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/user/manual-operations/active', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const next = (await response.json()) as ActiveManualOperationPayload | null;
        if (next?.updatedAt !== operation?.updatedAt || next?.id !== operation?.id) {
          setOperation(next);
          router.refresh();
        }
      } catch {
        // Keep the last server-provided state during a transient polling failure.
      }
    };
    const timer = window.setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [operation?.id, operation?.updatedAt, router]);

  const remaining = operation ? Math.max(0, new Date(operation.expiresAt).getTime() - now) : 0;

  if (!operation) return null;

  const awaitingDeposit = operation.state === 'awaiting_deposit';
  const verifyingExpiry = awaitingDeposit && remaining === 0;
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  const countdown = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const warning = [
    'pending_user_confirm',
    'pending_admin_confirm',
    'pending_candidate_resolution',
    'on_hold',
  ].includes(operation.state);

  const copy = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    window.setTimeout(() => setCopied((current) => (current === field ? null : current)), 1_500);
  };

  return (
    <section
      className={`mb-6 rounded-xl border p-4 shadow-sm ${warning ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-blue-500/30 bg-blue-500/10'}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="font-medium">{messageFor(operation.state, verifyingExpiry)}</div>
          {awaitingDeposit ? (
            <>
              <p className="text-sm">
                Depositá exactamente{' '}
                <strong className="font-mono text-base">
                  {operation.expectedDepositAmount} {operation.fromAsset}
                </strong>{' '}
                en {operation.fromNetwork}
                {!verifyingExpiry ? (
                  <>
                    {' '}
                    · quedan <strong className="font-mono">{countdown}</strong>
                  </>
                ) : null}
              </p>
              <CopyRow
                label="Dirección"
                value={operation.depositAddress}
                copied={copied === 'address'}
                onCopy={() => operation.depositAddress && copy(operation.depositAddress, 'address')}
              />
              {operation.depositMemo ? (
                <CopyRow
                  label="Memo/tag"
                  value={operation.depositMemo}
                  copied={copied === 'memo'}
                  onCopy={() => operation.depositMemo && copy(operation.depositMemo, 'memo')}
                />
              ) : null}
            </>
          ) : null}
          {operation.state === 'pending_user_confirm' ? (
            <p className="text-sm">
              Recibimos {operation.receivedAmount ?? operation.expectedDepositAmount}{' '}
              {operation.fromAsset}. Revisá la cotización y confirmá para continuar.
            </p>
          ) : null}
          {operation.estimatedOutput ? (
            <p className="text-xs text-muted-foreground">
              Estimado inicial: {operation.estimatedOutput} {operation.toAsset} en{' '}
              {operation.toNetwork}
            </p>
          ) : null}
        </div>
        <Link
          href="/operations"
          className="shrink-0 text-sm font-medium text-primary underline underline-offset-4"
        >
          Ver operación
        </Link>
      </div>
    </section>
  );
}

function messageFor(state: string, verifyingExpiry: boolean): string {
  if (verifyingExpiry) return 'Verificando la expiración de la operación…';
  if (state === 'awaiting_deposit') return 'Tenés una operación manual abierta';
  if (state === 'awaiting_deposit_confirmation')
    return 'Depósito detectado — esperando confirmaciones de red';
  if (state === 'pending_user_confirm') return 'Depósito recibido — confirmá tu operación';
  if (state === 'pending_admin_confirm')
    return 'Depósito recibido con diferencia — lo está revisando el admin';
  if (state === 'pending_candidate_resolution')
    return 'El payout terminó — estamos resolviendo depósitos adicionales';
  if (state === 'on_hold') return 'La operación está en revisión operativa';
  return `${PROCESSING_MESSAGES[state] ?? 'Procesando tu operación'}…`;
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <code className="break-all">{value ?? 'No disponible'}</code>
      {value ? (
        <button
          type="button"
          onClick={onCopy}
          className="rounded border bg-background px-2 py-1 hover:bg-accent"
        >
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      ) : null}
    </div>
  );
}
