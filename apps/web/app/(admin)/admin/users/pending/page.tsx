import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function PendingUsersPage() {
  const pending = await db.query.users.findMany({
    where: and(eq(users.status, 'pending'), isNull(users.deletedAt)),
    orderBy: [desc(users.createdAt)],
    limit: 100,
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios pendientes</h1>
        <p className="text-sm text-muted-foreground">
          Usuarios que iniciaron `/start` en Telegram y esperan tu aprobacion.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{pending.length} pendientes</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay usuarios pendientes.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Telegram</TableHead>
                  <TableHead>Telegram ID</TableHead>
                  <TableHead>Esperando desde</TableHead>
                  <TableHead className="text-right">Accion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.telegramUsername ?? '-'}</TableCell>
                    <TableCell className="font-mono">{u.telegramId ?? '-'}</TableCell>
                    <TableCell>{formatDate(u.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm">
                        <Link href={`/admin/users/${u.id}`}>Revisar</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
