import { auth } from '@/auth';
import { db } from '@/lib/db';
import { getActiveManualOperationForUser } from '@/lib/user-manual-operations';
import { users } from '@rb/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!user || user.status !== 'approved' || user.deletedAt) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const operation = await getActiveManualOperationForUser(user.id);
  return NextResponse.json(operation, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}
