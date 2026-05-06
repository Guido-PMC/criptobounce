import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { admin2fa } from '@rb/db';

export async function Admin2FAReminder() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') return null;
  const tfa = await db.query.admin2fa.findFirst({ where: eq(admin2fa.userId, session.user.id) });
  if (tfa?.enabled) return null;
  return (
    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900 mb-4">
      Tu cuenta admin no tiene 2FA. Activala desde{' '}
      <Link href="/admin/security" className="underline font-medium">
        /admin/security
      </Link>{' '}
      antes de operar en produccion.
    </div>
  );
}
