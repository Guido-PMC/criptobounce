import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { invitations } from '@rb/db';
import { INVITATION_COOKIE } from '@/auth';

export default async function InvitationLanding({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const inv = await db.query.invitations.findFirst({
    where: and(
      eq(invitations.token, token),
      isNull(invitations.usedAt),
      gte(invitations.expiresAt, new Date()),
    ),
  });

  if (!inv) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">Invitacion invalida</h1>
          <p className="text-muted-foreground">
            Este link expiro o ya fue usado. Pedile al admin que te genere uno nuevo.
          </p>
        </div>
      </main>
    );
  }

  const c = await cookies();
  c.set(INVITATION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 30,
    path: '/',
  });

  redirect('/login');
}
