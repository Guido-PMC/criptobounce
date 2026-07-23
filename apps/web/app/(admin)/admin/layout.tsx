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
    <div className="min-h-screen flex bg-slate-50">
      <aside className="admin-sidebar w-60 shrink-0 border-r border-slate-800 bg-slate-950 p-4 text-slate-100 space-y-1">
        <div className="px-1.5 mb-5 flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-amber-400 text-slate-950 grid place-items-center text-xs font-bold tracking-tight">
            R
          </div>
          <div>
            <div className="font-semibold text-sm tracking-tight leading-none">Robobounce</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-400 mt-0.5">
              consola admin
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
          className="block mt-4 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-200 transition-colors duration-150 hover:bg-amber-400/20"
        >
          Cambiar a vista usuario
        </Link>

        <div className="pt-4 mt-4 border-t border-slate-800 text-xs text-slate-400 break-all">
          {admin.email}
        </div>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <Button
            variant="outline"
            size="sm"
            type="submit"
            className="w-full mt-2 border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            Salir
          </Button>
        </form>
      </aside>
      <main className="flex-1 p-6 overflow-auto animate-fade-in">
        <div className="-mx-6 -mt-6 mb-6 flex items-center justify-between border-b border-amber-300/60 bg-amber-50 px-6 py-2 text-xs text-amber-950">
          <span className="flex items-center gap-2 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Configuración administrativa
          </span>
          <span className="text-amber-800">Los cambios pueden afectar a todos los usuarios</span>
        </div>
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
