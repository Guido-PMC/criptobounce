'use client';

import { useEffect, useState } from 'react';

export function ManualOperationCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (remaining === null) return <span>Calculando…</span>;
  if (remaining === 0) return <span className="text-amber-600">Verificando expiración…</span>;
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return (
    <span className="font-mono">
      {minutes}:{String(seconds).padStart(2, '0')}
    </span>
  );
}
