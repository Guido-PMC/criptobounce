import Link from 'next/link';
import { desc, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AllUsersPage() {
  const all = await db
    .select()
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt))
    .limit(500);

  const variants: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
    approved: 'success',
    pending: 'warning',
    suspended: 'destructive',
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <Button variant="outline" asChild>
          <Link href="/admin/users/pending">Ver pendientes</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{all.length} usuarios totales</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telegram</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Pausa</TableHead>
                <TableHead>Creado</TableHead>
                <TableHead className="text-right">Accion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {all.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.telegramUsername ?? String(u.telegramId ?? '-')}</TableCell>
                  <TableCell>{u.googleEmail ?? '-'}</TableCell>
                  <TableCell>{u.role}</TableCell>
                  <TableCell>
                    <Badge variant={variants[u.status] ?? 'secondary'}>{u.status}</Badge>
                  </TableCell>
                  <TableCell>{u.isPaused ? 'paused' : '-'}</TableCell>
                  <TableCell>{formatDate(u.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/users/${u.id}`}>Ver</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
