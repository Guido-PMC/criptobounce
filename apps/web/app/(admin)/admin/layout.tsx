import { signOut } from '@/auth';
import { Admin2FAReminder } from '@/components/admin-2fa-reminder';
import { NavLink } from '@/components/nav-link';
import { Button } from '@/components/ui/button';
import { requireRevalidatedAdmin } from '@/lib/admin-security';
import { db } from '@/lib/db';
import { manualOperations } from '@rb/db';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireRevalidatedAdmin().catch(() => null);
  if (!admin) {
    redirect('/login');
  }
  const pendingManualCount = await db.$count(
    manualOperations,
    inArray(manualOperations.state, ['pending_admin_confirm', 'on_hold']),
  );

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r border-border/60 bg-card/50 backdrop-blur-sm p-4 space-y-1">
        <div className="px-1.5 mb-5 flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-foreground text-background grid place-items-center text-xs font-bold tracking-tight">
            R
          </div>
          <div>
            <div className="font-semibold text-sm tracking-tight leading-none">Robobounce</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
              admin
            </div>
          </div>
        </div>

        <NavLink href="/admin/users/pending" label="Pendientes" />
        <NavLink href="/admin/users" label="Usuarios" exact />
        <NavLink href="/admin/operations" label="Operaciones" />
        <NavLink href="/admin/manual-operations" label="Operaciones manuales" />
        <NavLink href="/admin/api-calls" label="Llamadas API" />
        <NavLink href="/admin/balances" label="Balances" />
        <NavLink href="/admin/revenue" label="Revenue" />
        <NavLink href="/admin/system" label="Sistema" />
        <NavLink href="/admin/security" label="Seguridad (2FA)" />

        <Link
          href="/dashboard"
          className="block mt-4 px-3 py-1.5 rounded-md text-sm border border-border/70 bg-secondary/60 hover:bg-secondary transition-colors duration-150"
        >
          Volver al menu de usuario
        </Link>

        <div className="pt-4 mt-4 border-t border-border/60 text-xs text-muted-foreground break-all">
          {admin.email}
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
        <Admin2FAReminder />
        {pendingManualCount > 0 ? (
          <Link
            href="/admin/manual-operations"
            className="mb-4 flex items-center justify-between rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm"
          >
            <span>
              <strong>{pendingManualCount}</strong>{' '}
              {pendingManualCount === 1
                ? 'operación manual requiere revisión'
                : 'operaciones manuales requieren revisión'}
            </span>
            <span className="font-medium text-primary underline">Revisar</span>
          </Link>
        ) : null}
        {children}
      </main>
    </div>
  );
}
