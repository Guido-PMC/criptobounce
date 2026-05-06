import { eq, and, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLog, bounceJobs, platformCommissions, systemSettings, type MaintenanceModeValue } from '@rb/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MaintenanceToggle } from './maintenance-toggle';
import { PlatformCommissionsEditor } from './platform-commissions';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const maintRow = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, 'maintenance_mode'),
  });
  const maint = (maintRow?.value as MaintenanceModeValue | undefined) ?? { enabled: false };

  const inFlightCount = await db.$count(
    bounceJobs,
    inArray(bounceJobs.state, ['converting', 'awaiting_conversion', 'withdrawing', 'awaiting_withdrawal']),
  );

  const commissions = await db.select().from(platformCommissions);

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Sistema</h1>

      <Card>
        <CardHeader>
          <CardTitle>Modo mantenimiento</CardTitle>
          <CardDescription>
            Cuando esta activo, no se toman jobs nuevos. Jobs en vuelo terminan el paso actual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MaintenanceToggle initial={maint} inFlightCount={inFlightCount} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Comisiones de plataforma (ocultas al usuario)</CardTitle>
          <CardDescription>
            Estas comisiones se cobran del usuario sin que las vean. Se acumulan en la cuenta de
            exchange y se barren al wallet master.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlatformCommissionsEditor initial={commissions.map((c) => ({
            asset: c.asset,
            percent: String(c.percent),
            fixedAmount: String(c.fixedAmount),
          }))} />
        </CardContent>
      </Card>
    </div>
  );
}
