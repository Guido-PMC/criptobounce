import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { admin2fa, users } from '@rb/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Enroll2FAFlow } from './enroll-flow';

export const dynamic = 'force-dynamic';

export default async function AdminSecurityPage() {
  const session = await auth();
  const userId = session?.user.id;
  if (!userId) return null;

  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const tfa = await db.query.admin2fa.findFirst({ where: eq(admin2fa.userId, userId) });

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">Seguridad de tu cuenta admin</h1>

      <Card>
        <CardHeader>
          <CardTitle>2FA TOTP</CardTitle>
          <CardDescription>
            Recomendado: vincula Google Authenticator, Authy o 1Password antes de activar el modo
            produccion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Enroll2FAFlow alreadyEnrolled={Boolean(tfa?.enabled)} email={me?.googleEmail ?? ''} />
        </CardContent>
      </Card>
    </div>
  );
}
