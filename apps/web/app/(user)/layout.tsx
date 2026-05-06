import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { Button } from '@/components/ui/button';
import { NavLink } from '@/components/nav-link';

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.status !== 'approved') redirect('/login?error=NotApproved');

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r border-border/60 bg-card/50 backdrop-blur-sm p-4 space-y-1 no-print">
        <div className="px-1.5 mb-5 flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-foreground text-background grid place-items-center text-xs font-bold tracking-tight">
            R
          </div>
          <div className="font-semibold text-sm tracking-tight">Robobounce</div>
        </div>

        <NavLink href="/dashboard" label="Dashboard" />
        <NavLink href="/receive" label="Recibir" />
        <NavLink href="/wallets" label="Wallets de destino" />
        <NavLink href="/rules" label="Reglas de ruteo" />
        <NavLink href="/transactions" label="Transacciones" />
        <NavLink href="/settings" label="Configuracion" />

        {session.user.role === 'admin' ? (
          <Link
            href="/admin"
            className="block mt-4 px-3 py-1.5 rounded-md text-sm border border-border/70 bg-secondary/60 hover:bg-secondary transition-colors duration-150"
          >
            Ir al panel admin
          </Link>
        ) : null}

        <div className="pt-4 mt-4 border-t border-border/60 text-xs text-muted-foreground break-all">
          {session.user.email}
        </div>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <Button variant="outline" size="sm" type="submit" className="w-full mt-2">
            Salir
          </Button>
        </form>
      </aside>
      <main className="flex-1 p-6 overflow-auto animate-fade-in">{children}</main>
    </div>
  );
}
