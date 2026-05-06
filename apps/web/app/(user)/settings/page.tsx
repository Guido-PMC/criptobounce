import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { userCommissions, users } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ASSETS } from '@rb/domain';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PauseToggles } from './pause-toggles';
import { ReceiptSpreadSlider } from './receipt-spread-slider';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth();
  const userId = session!.user.id;

  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!me) return null;

  const commissions = await db
    .select()
    .from(userCommissions)
    .where(eq(userCommissions.userId, userId));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Configuracion</h1>

      <Card>
        <CardHeader>
          <CardTitle>Pausa de reenvios</CardTitle>
        </CardHeader>
        <CardContent>
          <PauseToggles
            globalPaused={me.isPaused}
            pausedAssets={me.pausedAssets}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Comprobantes de operacion</CardTitle>
        </CardHeader>
        <CardContent>
          <ReceiptSpreadSlider initialFraction={Number(me.receiptSpreadPercent ?? 0)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tus comisiones</CardTitle>
        </CardHeader>
        <CardContent>
          {commissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin comisiones configuradas. Por defecto, no se cobra comision a tu favor.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">% del monto</TableHead>
                  <TableHead className="text-right">Fijo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.map((c) => (
                  <TableRow key={`${c.userId}-${c.asset}`}>
                    <TableCell>{c.asset === '*' ? 'Default' : c.asset}</TableCell>
                    <TableCell className="text-right">
                      {(Number(c.percent) * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right">{c.fixedAmount}</TableCell>
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
