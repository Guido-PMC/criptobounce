import { and, desc, eq, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { destinationWallets } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WalletEditor } from './wallet-editor';

export const dynamic = 'force-dynamic';

export default async function WalletsPage() {
  const session = await auth();
  const userId = session!.user.id;

  const wallets = await db
    .select()
    .from(destinationWallets)
    .where(and(eq(destinationWallets.userId, userId), isNull(destinationWallets.deletedAt)))
    .orderBy(desc(destinationWallets.createdAt));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Wallets de destino</h1>
        <WalletEditor />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{wallets.length} wallets activas</CardTitle>
        </CardHeader>
        <CardContent>
          {wallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aun no agregaste wallets. Configura al menos una USDT-TRC20 para recibir tus
              reenvios.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alias</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Red</TableHead>
                  <TableHead>Direccion</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>{w.label}</TableCell>
                    <TableCell>{w.asset}</TableCell>
                    <TableCell>{w.network}</TableCell>
                    <TableCell className="font-mono text-xs break-all">{w.address}</TableCell>
                    <TableCell>
                      {w.isDefault ? <Badge variant="success">Default</Badge> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <WalletEditor wallet={w} />
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
