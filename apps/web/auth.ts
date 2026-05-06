import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { cookies } from 'next/headers';
import { and, eq, isNull, gte } from 'drizzle-orm';
import { db } from './lib/db';
import { invitations, users } from '@rb/db';

export const INVITATION_COOKIE = 'rb_invitation_token';

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { prompt: 'consent', access_type: 'offline' } },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return '/login?error=NoEmail';

      const existing = await db.query.users.findFirst({
        where: and(eq(users.googleEmail, email), isNull(users.deletedAt)),
      });

      if (existing) {
        if (existing.status !== 'approved') return '/login?error=NotApproved';
        return true;
      }

      // No existing google_email -> require invitation cookie
      const c = await cookies();
      const token = c.get(INVITATION_COOKIE)?.value;
      if (!token) return '/login?error=NotInvited';

      const inv = await db.query.invitations.findFirst({
        where: and(
          eq(invitations.token, token),
          isNull(invitations.usedAt),
          gte(invitations.expiresAt, new Date()),
        ),
      });
      if (!inv) return '/login?error=InvalidInvitation';

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ googleEmail: email })
          .where(eq(users.id, inv.userId));
        await tx
          .update(invitations)
          .set({ usedAt: new Date() })
          .where(eq(invitations.id, inv.id));
      });

      c.delete(INVITATION_COOKIE);
      return true;
    },
    async jwt({ token, user }) {
      // Resolve our internal user on first auth
      if (user?.email) {
        const internal = await db.query.users.findFirst({
          where: and(eq(users.googleEmail, user.email.toLowerCase()), isNull(users.deletedAt)),
        });
        if (internal) {
          token.userId = internal.id;
          token.role = internal.role;
          token.status = internal.status;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId as string | undefined) ?? '';
        session.user.role = (token.role as string | undefined) ?? 'user';
        session.user.status = (token.status as string | undefined) ?? 'pending';
      }
      return session;
    },
  },
});

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role: string;
      status: string;
    };
  }
}
