import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center p-8 overflow-hidden">
      {/* Soft radial backdrop for a premium feel without being heavy */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_60%_at_50%_30%,hsl(var(--accent)),transparent_70%)] opacity-60"
      />

      <div className="max-w-xl text-center space-y-8 animate-slide-up">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card/70 backdrop-blur px-3 py-1 text-xs text-muted-foreground shadow-sm">
            <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgb(16_185_129_/_0.5)]" />
            Plataforma activa
          </div>
          <h1 className="text-5xl font-semibold tracking-tight bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent">
            Robobounce
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            Reenvio automatico de criptomonedas: depositos detectados, convertidos y girados a la
            wallet final sin intervencion manual.
          </p>
        </div>

        <div className="flex gap-3 justify-center">
          <Button asChild size="lg">
            <Link href="/login">Iniciar sesion</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
