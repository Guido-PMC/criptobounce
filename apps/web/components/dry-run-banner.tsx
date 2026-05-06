export function DryRunBanner() {
  if (process.env.DRY_RUN !== 'true') return null;
  return (
    <div className="bg-amber-100 text-amber-900 px-3 py-1 text-xs text-center font-medium border-b border-amber-300/70 no-print">
      Modo simulacion: las operaciones de escritura no se ejecutan en este entorno.
    </div>
  );
}
