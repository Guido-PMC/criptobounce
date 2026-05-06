'use client';

export function JsonViewer({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="text-xs text-muted-foreground">(vacio)</p>;
  }
  let pretty: string;
  try {
    pretty = JSON.stringify(value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <pre className="mt-1 max-h-96 overflow-auto rounded bg-muted p-2 text-xs">
      <code>{pretty}</code>
    </pre>
  );
}
