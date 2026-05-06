import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, shortId } from '@/lib/utils';
import { bounceJobs, deposits, users, withdrawals } from '@rb/db';
import {
  computeReceiptDisplay,
  receiptCryptoAsset,
  receiptDecimals,
  receiptSide,
  type ReceiptSide,
} from '@rb/domain';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';

function fmt(n: number, decimals: number): string {
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function operationLabel(side: ReceiptSide, crypto: string): string {
  return side === 'SELL' ? `Venta de ${crypto}` : `Compra de ${crypto}`;
}

export default async function ComprobantePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user.id;

  const job = await db.query.bounceJobs.findFirst({
    where: eq(bounceJobs.id, id),
  });
  if (!job) notFound();

  const dep = await db.query.deposits.findFirst({
    where: eq(deposits.id, job.depositId),
  });
  if (!dep || dep.userId !== userId) notFound();

  // Receipt only renders for COMPLETED conversions where assetIn != assetOut.
  // For non-eligible jobs we redirect users back to transactions list.
  if (job.state !== 'done') notFound();

  const payout = await db.query.withdrawals.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.bounceJobId, job.id), eq(t.type, 'user_payout')),
  });
  if (!payout) notFound();

  const assetIn = dep.asset;
  const assetOut = payout.asset;
  const side = receiptSide(assetIn, assetOut);
  const crypto = receiptCryptoAsset(assetIn, assetOut);
  if (!side || !crypto) notFound();

  // Pull the snapshot first; fall back to the user's current setting only if
  // the bounce predates the snapshot column (legacy rows).
  let spreadFraction: number;
  if (job.receiptSpreadPercent !== null) {
    spreadFraction = Number(job.receiptSpreadPercent);
  } else {
    const owner = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { receiptSpreadPercent: true },
    });
    spreadFraction = Number(owner?.receiptSpreadPercent ?? 0);
  }

  const amountIn = Number(job.userAmountGross ?? dep.amount);
  // Pick the OUT amount that drives the displayed rate.
  //
  //  - v3 (current): use the actual on-chain amount, reconstructed from the
  //    withdrawal row as `submitted - fee`. The bounce engine grosses up the
  //    submission so this equals `userAmountNet` whenever MEX charges the
  //    expected fee; if the actual fee differs, the receipt still closes the
  //    loop with what the counterparty observes on-chain.
  //  - v2: use `userAmountNet` (assumed equal to on-chain after the fix, but
  //    receipts issued under buggy v2 were `actual_fee` short).
  //  - v1 / NULL (legacy): use the raw post-conversion amount.
  let realAmountOut: number;
  if (job.receiptCalcVersion === 3) {
    const submittedAmount = Number(payout.amount ?? 0);
    const actualFee = Number(payout.fee ?? job.networkFeeEstimated ?? 0);
    realAmountOut = Math.max(0, submittedAmount - actualFee);
  } else if (job.receiptCalcVersion === 2) {
    realAmountOut = Number(job.userAmountNet ?? 0);
  } else {
    realAmountOut = Number(job.userAmountAfterConv ?? 0);
  }

  const display = computeReceiptDisplay(
    { amountIn, realAmountOut, side },
    spreadFraction,
  );

  const inDecimals = receiptDecimals(assetIn);
  const outDecimals = receiptDecimals(assetOut);
  const rateDecimals = 2;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between no-print">
        <Button asChild variant="outline" size="sm">
          <Link href="/transactions">{'<- Volver'}</Link>
        </Button>
        <PrintButton />
      </div>

      <Card className="print-area">
        <CardHeader className="border-b">
          <div className="flex items-baseline justify-between gap-4">
            <CardTitle className="text-xl">Comprobante de operacion</CardTitle>
            <span className="font-mono text-xs text-muted-foreground">
              #{shortId(job.id)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {operationLabel(side, crypto)}
          </p>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
            <div className="text-muted-foreground">Fecha</div>
            <div className="text-right">{formatDate(dep.detectedAt)}</div>

            <div className="text-muted-foreground">Operacion</div>
            <div className="text-right font-medium">
              {operationLabel(side, crypto)}
            </div>

            <div className="text-muted-foreground">Monto entregado</div>
            <div className="text-right tabular-nums">
              {fmt(display.displayedAmountIn, inDecimals)} {assetIn}
            </div>

            <div className="text-muted-foreground">Tipo de cambio</div>
            <div className="text-right tabular-nums">
              {fmt(display.displayedRateUsdtPerUnit, rateDecimals)} USDT / {crypto}
            </div>

            <div className="text-muted-foreground">Monto recibido</div>
            <div className="text-right tabular-nums font-semibold">
              {fmt(display.displayedAmountOut, outDecimals)} {assetOut}
            </div>

            <div className="text-muted-foreground">Red de destino</div>
            <div className="text-right">{payout.network}</div>

            <div className="text-muted-foreground">Direccion destino</div>
            <div className="text-right break-all font-mono text-xs">
              {payout.address}
            </div>

            {payout.onChainTx ? (
              <>
                <div className="text-muted-foreground">Tx on-chain</div>
                <div className="text-right break-all font-mono text-xs">
                  {payout.onChainTx}
                </div>
              </>
            ) : null}
          </div>

          <div className="pt-4 border-t text-[11px] text-muted-foreground leading-relaxed">
            Operacion liquidada por Robobounce. Los montos detallados en este
            comprobante reflejan el tipo de cambio acordado para la operacion.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
