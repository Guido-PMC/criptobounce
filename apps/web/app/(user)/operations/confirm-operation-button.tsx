'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { type ConfirmManualOperationState, confirmManualOperationAction } from './actions';

const INITIAL_STATE: ConfirmManualOperationState = { ok: false };

export function ConfirmOperationButton({ operationId }: { operationId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    confirmManualOperationAction.bind(null, operationId),
    INITIAL_STATE,
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);

  return (
    <form action={action} className="space-y-2">
      <Button type="submit" disabled={pending || state.ok}>
        {pending ? 'Confirmando…' : state.ok ? 'Confirmada' : 'Confirmar operación'}
      </Button>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
