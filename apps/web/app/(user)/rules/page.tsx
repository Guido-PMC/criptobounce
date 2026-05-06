import { and, asc, eq, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { destinationWallets, routingRules } from '@rb/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RuleEditor } from './rule-editor';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const session = await auth();
  const userId = session!.user.id;

  const rules = await db
    .select({
      id: routingRules.id,
      fromAsset: routingRules.fromAsset,
      fromNetwork: routingRules.fromNetwork,
      toAsset: routingRules.toAsset,
      toNetwork: routingRules.toNetwork,
      enabled: routingRules.enabled,
      priority: routingRules.priority,
      walletLabel: destinationWallets.label,
      walletAddress: destinationWallets.address,
      destinationWalletId: routingRules.destinationWalletId,
    })
    .from(routingRules)
    .innerJoin(destinationWallets, eq(destinationWallets.id, routingRules.destinationWalletId))
    .where(and(eq(routingRules.userId, userId), isNull(routingRules.deletedAt)))
    .orderBy(asc(routingRules.priority));

  const wallets = await db
    .select({
      id: destinationWallets.id,
      label: destinationWallets.label,
      asset: destinationWallets.asset,
      network: destinationWallets.network,
    })
    .from(destinationWallets)
    .where(and(eq(destinationWallets.userId, userId), isNull(destinationWallets.deletedAt)));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reglas de ruteo</h1>
        <RuleEditor wallets={wallets} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Como se rutean tus depositos</CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin reglas. Crea una para que el sistema sepa donde mandar tus reenvios. Si no hay
              reglas, los depositos quedan en hold.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prio</TableHead>
                  <TableHead>Si recibo</TableHead>
                  <TableHead>Convertir a</TableHead>
                  <TableHead>Wallet destino</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell>
                      {r.fromAsset ?? '*'} en {r.fromNetwork ?? '*'}
                    </TableCell>
                    <TableCell>
                      {r.toAsset} en {r.toNetwork}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{r.walletLabel}</span>
                      <div className="text-xs text-muted-foreground font-mono break-all">
                        {r.walletAddress.slice(0, 16)}...
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.enabled ? (
                        <Badge variant="success">Activa</Badge>
                      ) : (
                        <Badge variant="secondary">Pausada</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <RuleEditor wallets={wallets} rule={r} />
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
