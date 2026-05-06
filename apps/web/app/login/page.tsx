import { signIn } from '@/auth';
import { Button } from '@/components/ui/button';

const ERR: Record<string, string> = {
  NoEmail: 'Tu cuenta de Google no devolvio email.',
  NotApproved: 'Tu cuenta esta pendiente de aprobacion. Revisa Telegram.',
  NotInvited: 'No encontramos una invitacion valida. Pedile al admin que te reenvie el link.',
  InvalidInvitation: 'La invitacion expiro o ya fue usada. Pedile al admin un link nuevo.',
};

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const error = sp.error ? ERR[sp.error] ?? sp.error : null;

  return (
    <main className="relative min-h-screen flex items-center justify-center p-8 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_30%,hsl(var(--accent)),transparent_70%)] opacity-60"
      />

      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border/70 bg-card/90 backdrop-blur p-7 shadow-lg animate-slide-up">
        <div className="text-center space-y-1.5">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background font-bold mb-1">
            R
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Robobounce</h1>
          <p className="text-sm text-muted-foreground">Ingresa con tu cuenta de Google</p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive animate-fade-in">
            {error}
          </div>
        ) : null}

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: sp.next || '/dashboard' });
          }}
        >
          <Button type="submit" className="w-full" size="lg">
            <GoogleLogo className="size-4" />
            Continuar con Google
          </Button>
        </form>

        <p className="text-xs text-center text-muted-foreground leading-relaxed">
          Si es tu primer ingreso, abri el link que te mando el bot por Telegram.
        </p>
      </div>
    </main>
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#FFC107"
        d="M21.35 11.1H12v3.83h5.36C16.85 17.04 14.66 18.5 12 18.5 8.41 18.5 5.5 15.59 5.5 12S8.41 5.5 12 5.5c1.61 0 3.08.59 4.21 1.56l2.71-2.71C17.07 2.66 14.7 1.7 12 1.7 6.34 1.7 1.75 6.29 1.75 11.95S6.34 22.2 12 22.2c5.91 0 9.85-4.15 9.85-9.99 0-.67-.07-1.32-.5-1.11z"
      />
      <path
        fill="#FF3D00"
        d="M3.05 7.34l3.16 2.32C7.04 7.93 9.36 6.5 12 6.5c1.61 0 3.08.59 4.21 1.56l2.71-2.71C17.07 3.66 14.7 2.7 12 2.7c-3.78 0-7.05 2.13-8.7 5.04l-.25-.4z"
      />
      <path
        fill="#4CAF50"
        d="M12 22.2c2.66 0 5.05-1.02 6.85-2.68l-3.13-2.65c-1.02.7-2.31 1.13-3.72 1.13-2.65 0-4.83-1.46-5.69-3.46L3.1 16.95C4.74 19.96 8.05 22.2 12 22.2z"
      />
      <path
        fill="#1976D2"
        d="M21.35 11.1H12v3.83h5.36c-.41 1.16-1.21 2.18-2.34 2.94l3.13 2.65c1.83-1.69 3.05-4.18 3.05-7.42 0-.67-.07-1.32-.2-2z"
      />
    </svg>
  );
}
