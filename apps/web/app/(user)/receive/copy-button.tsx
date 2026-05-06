'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Some browsers reject clipboard writes outside of user gestures or in insecure contexts.
          // Fall back to a prompt so the user can still copy manually.
          window.prompt('Copia el texto:', value);
        }
      }}
    >
      {copied ? 'Copiado' : label}
    </Button>
  );
}
