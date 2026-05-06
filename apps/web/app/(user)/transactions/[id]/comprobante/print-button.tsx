'use client';

import { Button } from '@/components/ui/button';

export function PrintButton() {
  return (
    <Button
      variant="default"
      size="sm"
      onClick={() => {
        if (typeof window !== 'undefined') window.print();
      }}
    >
      Imprimir
    </Button>
  );
}
