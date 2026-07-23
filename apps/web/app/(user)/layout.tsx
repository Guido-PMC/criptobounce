import { auth, signOut } from '@/auth';
import { NavLink } from '@/components/nav-link';
import { OpenOperationBanner } from '@/components/open-operation-banner';
import { Button } from '@/components/ui/button';
import { getActiveManualOperationForUser } from '@/lib/user-manual-operations';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.status !== 'approved') redirect('/login?error=NotApproved');
  const activeOperation = await getActiveManualOperationForUser(session.user.id);

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r border-border/60 bg-card/50 backdrop-blur-sm p-4 space-y-1 no-print">
        <div className="px-1.5 mb-5 flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-foreground text-background grid place-items-center text-xs font-bold tracking-tight">
            R
          </div>
          <div>
            <div className="font-semibold text-sm tracking-tight leading-none">Robobounce</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              vista usuario
            </div>
          </div>
        </div>

        <NavLink href="/dashboard" label="Dashboard" />
        <NavLink href="/receive" label="Recibir" />
        <NavLink href="/operations" label="Operaciones" />
        <NavLink href="/wallets" label="Wallets de destino" />
        <NavLink href="/rules" label="Reglas de ruteo" />
        <NavLink href="/transactions" label="Transacciones" />
        <NavLink href="/settings" label="Configuracion" />

        {session.user.role === 'admin' ? (
          <Link
            href="/admin"
            className="block mt-4 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors duration-150 hover:bg-amber-100"
          >
            Abrir consola administrativa
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
      <main className="flex-1 p-6 overflow-auto animate-fade-in">
        <OpenOperationBanner initialOperation={activeOperation} />
        {children}
      </main>
    </div>
  );
}
