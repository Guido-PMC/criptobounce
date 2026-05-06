'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generate2FAAction, verify2FAAction, disable2FAAction } from './actions';

export function Enroll2FAFlow({
  alreadyEnrolled,
  email,
}: {
  alreadyEnrolled: boolean;
  email: string;
}) {
  const [step, setStep] = useState<'idle' | 'qr' | 'verify' | 'done'>(
    alreadyEnrolled ? 'done' : 'idle',
  );
  const [qr, setQr] = useState<{ otpauth: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  if (step === 'done') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-green-700">2FA esta activo en tu cuenta.</p>
        <Button
          variant="outline"
          onClick={() =>
            start(async () => {
              if (!confirm('Desactivar 2FA?')) return;
              await disable2FAAction();
              setStep('idle');
            })
          }
        >
          Desactivar 2FA
        </Button>
      </div>
    );
  }

  if (step === 'idle') {
    return (
      <Button
        onClick={() =>
          start(async () => {
            setErr(null);
            const res = await generate2FAAction(email);
            if (!res.ok) setErr(res.error);
            else {
              setQr({ otpauth: res.otpauth, qrDataUrl: res.qrDataUrl });
              setStep('qr');
            }
          })
        }
      >
        Comenzar enrollment
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      {qr ? (
        <div className="space-y-2">
          <p className="text-sm">Escanea este QR con tu app de autenticacion:</p>
          {/* biome-ignore lint/a11y/useAltText: this is a generated 2FA QR */}
          <img src={qr.qrDataUrl} className="w-48 h-48 border rounded" />
          <details className="text-xs">
            <summary className="cursor-pointer">o pega manualmente</summary>
            <code className="block mt-1 break-all bg-muted p-2 rounded">{qr.otpauth}</code>
          </details>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="code">Codigo de 6 digitos</Label>
        <Input
          id="code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      <Button
        onClick={() =>
          start(async () => {
            setErr(null);
            const res = await verify2FAAction(code);
            if (!res.ok) setErr(res.error);
            else setStep('done');
          })
        }
        disabled={code.length !== 6 || isPending}
      >
        Verificar y activar
      </Button>
    </div>
  );
}
